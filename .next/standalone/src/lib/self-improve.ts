// ─── Self-improve agent (24/7) — P1 measure · P2 discover · P3 promote/rollback ─
// Runs inside the engine scheduler. Never opens live orders — only retunes
// AutoConfig gates/stake within hard bounds after enough closed paper trades.
// LLM RCA may *suggest*; this module *decides* with numeric rules only (P4).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { db } from "./db";
import { dataFile } from "./data-dir";
import type { AutoConfig } from "./autotrade";
import { methodIdOf, methodLabel, methodSnapshot, type MethodSnapshot } from "./method";

const STATE_FILE = dataFile("self-improve.json");
const AGENT_EVERY_MS = 6 * 60 * 60_000; // 6h
const MIN_N_MEASURE = 10;
const MIN_N_PROMOTE = 20;
const MIN_N_TIGHTEN = 15;

export interface MethodStats {
  methodId: string;
  n: number;
  wins: number;
  winRate: number;
  netRoe: number;
  expectancy: number; // netRoe / n
  avgWin: number;
  avgLoss: number;
}

export interface AgentState {
  lastTickAt: number;
  activeMethodId: string;
  activeSnap: MethodSnapshot | null;
  lastPromoteAt: number;
  lastNote: string;
}

export interface AgentTickResult {
  ok: boolean;
  kind: string;
  note: string;
  methods: MethodStats[];
  cfgPatch: Partial<AutoConfig> | null;
}

const defaultState = (): AgentState => ({
  lastTickAt: 0,
  activeMethodId: "",
  activeSnap: null,
  lastPromoteAt: 0,
  lastNote: "idle",
});

export function loadAgentState(): AgentState {
  try {
    if (!existsSync(STATE_FILE)) return defaultState();
    const j = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<AgentState>;
    return { ...defaultState(), ...j };
  } catch {
    return defaultState();
  }
}

export function saveAgentState(s: AgentState): void {
  try {
    mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch {
    /* ignore */
  }
}

export async function measureMethods(): Promise<MethodStats[]> {
  const rows = await db.autoTrade.findMany({
    where: { status: "closed" },
    select: { methodId: true, pnlPct: true },
  });
  const map = new Map<string, { n: number; wins: number; net: number; winSum: number; lossSum: number }>();
  for (const r of rows) {
    const id = r.methodId?.trim() || "legacy";
    const pnl = r.pnlPct ?? 0;
    const a = map.get(id) ?? { n: 0, wins: 0, net: 0, winSum: 0, lossSum: 0 };
    a.n += 1;
    a.net += pnl;
    if (pnl > 0) {
      a.wins += 1;
      a.winSum += pnl;
    } else if (pnl < 0) {
      a.lossSum += pnl;
    }
    map.set(id, a);
  }
  const out: MethodStats[] = [];
  for (const [methodId, a] of map) {
    out.push({
      methodId,
      n: a.n,
      wins: a.wins,
      winRate: a.n ? (a.wins / a.n) * 100 : 0,
      netRoe: Math.round(a.net * 100) / 100,
      expectancy: a.n ? Math.round((a.net / a.n) * 100) / 100 : 0,
      avgWin: a.wins ? a.winSum / a.wins : 0,
      avgLoss: a.n - a.wins ? a.lossSum / (a.n - a.wins) : 0,
    });
  }
  return out.sort((a, b) => b.n - a.n || b.expectancy - a.expectancy);
}

async function logEvent(
  kind: string,
  methodId: string,
  detail: unknown,
  note: string,
): Promise<void> {
  try {
    await db.improveEvent.create({
      data: {
        kind,
        methodId: methodId.slice(0, 32),
        detail: JSON.stringify(detail).slice(0, 8000),
        note: note.slice(0, 500),
      },
    });
  } catch (e) {
    console.warn(`[self-improve] log failed: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Numeric policy (P3/P4) — no LLM in the decision path.
 * - expectancy < 0 and n ≥ MIN_N_TIGHTEN → tighten gates, cut risk
 * - expectancy ≥ 0.3 and n ≥ MIN_N_PROMOTE and WR ≥ 48 → slight risk restore (cap)
 * - otherwise measure-only
 */
export function decidePatch(
  stats: MethodStats | undefined,
  cfg: AutoConfig,
): { patch: Partial<AutoConfig> | null; kind: string; note: string } {
  if (!stats || stats.n < MIN_N_MEASURE) {
    return {
      patch: null,
      kind: "skip",
      note: `need ≥${MIN_N_MEASURE} closed on active method (have ${stats?.n ?? 0})`,
    };
  }

  if (stats.n >= MIN_N_TIGHTEN && stats.expectancy < 0) {
    // 0.3.2 — floorAuto ON: bộ ba minScore/minAcc thuộc về learner (dynamic-floor.ts,
    // có flow-guard + FloorLog) — agent chỉ giữ quyền SIẾT RISK, không siết floor
    // nữa (hai nguồn đè nhau lên cùng ba số thì floor nhảy loạn, không ai giải thích được)
    if (cfg.floorAuto === true) {
      const nextRisk = Math.max(10, cfg.riskPct <= 10 ? 10 : cfg.riskPct === 25 ? 10 : cfg.riskPct === 50 ? 25 : 10);
      if (nextRisk === cfg.riskPct) {
        return {
          patch: null,
          kind: "skip",
          note: `floors auto-managed (floorAuto ON) · risk already ${cfg.riskPct}% · exp ${stats.expectancy}% n=${stats.n}`,
        };
      }
      return {
        patch: { riskPct: nextRisk as AutoConfig["riskPct"] },
        kind: "promote",
        note: `tighten RISK ONLY (floors auto-managed): exp ${stats.expectancy}% WR ${stats.winRate.toFixed(0)}% n=${stats.n} → risk ${nextRisk}%`,
      };
    }
    const nextScore = Math.min(85, Math.round(cfg.minScore + 2));
    const nextAcc = Math.min(85, Math.round(cfg.minAcc + 1));
    const nextRisk = Math.max(10, cfg.riskPct <= 10 ? 10 : cfg.riskPct === 25 ? 10 : cfg.riskPct === 50 ? 25 : 10);
    if (nextScore === cfg.minScore && nextAcc === cfg.minAcc && nextRisk === cfg.riskPct) {
      return {
        patch: null,
        kind: "skip",
        note: `already at tight bounds · exp ${stats.expectancy}% on n=${stats.n}`,
      };
    }
    return {
      patch: { minScore: nextScore, minAcc: nextAcc, riskPct: nextRisk as AutoConfig["riskPct"] },
      kind: "promote",
      note: `tighten: exp ${stats.expectancy}% WR ${stats.winRate.toFixed(0)}% n=${stats.n} → minScore ${nextScore} minAcc ${nextAcc} risk ${nextRisk}%`,
    };
  }

  if (stats.n >= MIN_N_PROMOTE && stats.expectancy >= 0.3 && stats.winRate >= 48) {
    // mild restore only from 10 → 25, never jump to 50/100 automatically
    if (cfg.riskPct === 10) {
      return {
        patch: { riskPct: 25 },
        kind: "promote",
        note: `restore risk 10→25 · exp ${stats.expectancy}% WR ${stats.winRate.toFixed(0)}% n=${stats.n}`,
      };
    }
    return {
      patch: null,
      kind: "skip",
      note: `method healthy exp ${stats.expectancy}% — no cfg change`,
    };
  }

  return {
    patch: null,
    kind: "measure",
    note: `tracking exp ${stats?.expectancy ?? 0}% WR ${stats?.winRate.toFixed(0) ?? 0}% n=${stats?.n ?? 0}`,
  };
}

export async function runAgentTick(
  cfg: AutoConfig,
  leverage: number,
  applyCfg: (patch: Partial<AutoConfig>) => void,
  force = false,
): Promise<AgentTickResult> {
  const state = loadAgentState();
  const now = Date.now();
  if (!force && state.lastTickAt && now - state.lastTickAt < AGENT_EVERY_MS) {
    return {
      ok: true,
      kind: "skip",
      note: `next tick in ${Math.ceil((AGENT_EVERY_MS - (now - state.lastTickAt)) / 60_000)}m`,
      methods: [],
      cfgPatch: null,
    };
  }

  const snap = methodSnapshot(cfg, leverage);
  const mid = methodIdOf(snap);
  state.activeMethodId = mid;
  state.activeSnap = snap;

  const methods = await measureMethods();
  const active = methods.find((m) => m.methodId === mid);
  const decision = decidePatch(active, cfg);

  // P2 discover: rank scored StrategyVariants (already in DB from lab) — log only
  let discoverNote = "";
  try {
    const variants = await db.strategyVariant.findMany({
      where: { scored: true },
      orderBy: { scoredAt: "desc" },
      take: 40,
    });
    type Met = { expectancy?: number; trades?: number; winRate?: number };
    let best: { name: string; exp: number; trades: number } | null = null;
    let baseExp: number | null = null;
    for (const v of variants) {
      let met: Met = {};
      try {
        met = JSON.parse(v.metrics ?? "{}") as Met;
      } catch {
        continue;
      }
      const exp = typeof met.expectancy === "number" ? met.expectancy : null;
      const trades = typeof met.trades === "number" ? met.trades : 0;
      if (exp == null || trades < 15) continue;
      if (v.baseline) baseExp = exp;
      if (!best || exp > best.exp) best = { name: v.name, exp, trades };
    }
    if (best) {
      discoverNote = `lab best "${best.name}" exp ${best.exp.toFixed(2)} (n=${best.trades})${baseExp != null ? ` vs baseline ${baseExp.toFixed(2)}` : ""}`;
      await logEvent("discover", mid, { best, baseExp }, discoverNote);
    }
  } catch {
    /* lab table optional */
  }

  let cfgPatch: Partial<AutoConfig> | null = null;
  if (decision.patch && now - state.lastPromoteAt > 12 * 60 * 60_000) {
    applyCfg(decision.patch);
    cfgPatch = decision.patch;
    state.lastPromoteAt = now;
    await logEvent(decision.kind, mid, { patch: decision.patch, active, snap }, decision.note);
  } else if (decision.patch) {
    decision.kind = "skip";
    decision.note = `promote cooldown · ${decision.note}`;
    await logEvent("skip", mid, { active }, decision.note);
  } else {
    await logEvent(decision.kind, mid, { active, methods: methods.slice(0, 5) }, decision.note);
  }

  state.lastTickAt = now;
  state.lastNote = [decision.note, discoverNote].filter(Boolean).join(" · ");
  saveAgentState(state);

  console.log(`[self-improve] ${state.lastNote}`);
  return {
    ok: true,
    kind: decision.kind,
    note: state.lastNote,
    methods,
    cfgPatch,
  };
}

export async function agentSnapshot(cfg: AutoConfig, leverage: number) {
  const state = loadAgentState();
  const methods = await measureMethods();
  const snap = methodSnapshot(cfg, leverage);
  const mid = methodIdOf(snap);
  let events: { id: string; kind: string; methodId: string; note: string; createdAt: string }[] = [];
  try {
    const rows = await db.improveEvent.findMany({ orderBy: { createdAt: "desc" }, take: 15 });
    events = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      methodId: r.methodId,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch {
    events = [];
  }
  return {
    activeMethodId: mid,
    activeLabel: methodLabel(snap),
    state,
    methods,
    events,
    cadenceHours: AGENT_EVERY_MS / 3_600_000,
  };
}
