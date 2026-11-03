// ─── Self-improve agent (24/7) — P1 measure · P2 discover · P3 promote/rollback ─
// Runs inside the engine scheduler. Never opens live orders — only retunes
// AutoConfig gates/stake within hard bounds after enough closed paper trades.
// LLM RCA may *suggest*; this module *decides* with numeric rules only (P4).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { db } from "./db";
import { dataFile } from "./data-dir";
import type { AutoConfig } from "./autotrade";
import { FLIP_COOLDOWN_CHOICES } from "./autotrade";
import { methodIdOf, methodLabel, methodSnapshot, type MethodSnapshot } from "./method";

const STATE_FILE = dataFile("self-improve.json");
const AGENT_EVERY_MS = 6 * 60 * 60_000; // 6h
const MIN_N_MEASURE = 10;
const MIN_N_PROMOTE = 20;
const MIN_N_TIGHTEN = 15;
const MIN_N_FLIP = 8; // need ≥8 closed flips before judging flip-expectancy

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

/**
 * Measure ONLY closed trades whose exit was a FLIP (exitKind="flip"), regardless
 * of methodId. Used by decidePatch to tune `flipCooldownMin` — the flip-specific
 * knob. Returns null when there are no flip trades (engine never flipped, or
 * flipCooldownMin was 0 and the model was decisive enough to churn).
 */
export async function measureFlips(): Promise<MethodStats | null> {
  const rows = await db.autoTrade.findMany({
    where: { status: "closed", exitKind: "flip" },
    select: { pnlPct: true },
  });
  if (rows.length === 0) return null;
  let n = 0;
  let wins = 0;
  let net = 0;
  let winSum = 0;
  let lossSum = 0;
  for (const r of rows) {
    const pnl = r.pnlPct ?? 0;
    n += 1;
    net += pnl;
    if (pnl > 0) {
      wins += 1;
      winSum += pnl;
    } else if (pnl < 0) {
      lossSum += pnl;
    }
  }
  return {
    methodId: "__flip__",
    n,
    wins,
    winRate: n ? (wins / n) * 100 : 0,
    netRoe: Math.round(net * 100) / 100,
    expectancy: n ? Math.round((net / n) * 100) / 100 : 0,
    avgWin: wins ? winSum / wins : 0,
    avgLoss: n - wins ? lossSum / (n - wins) : 0,
  };
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
 *
 * Entry and flip tuning are INDEPENDENT and ADDITIVE — both can fire in one
 * tick. Entry tuning moves `minScore/minAcc/riskPct`; flip tuning moves
 * `flipCooldownMin`. When both need action, the returned patch carries both.
 *
 * Entry:
 *  - expectancy < 0 and n ≥ MIN_N_TIGHTEN → tighten gates, cut risk
 *  - expectancy ≥ 0.3 and n ≥ MIN_N_PROMOTE and WR ≥ 48 → mild risk restore (10→25)
 * Flip:
 *  - expectancy < 0 and n ≥ MIN_N_FLIP → raise flipCooldownMin one step
 *  - expectancy ≥ 0.3 and WR ≥ 48 and n ≥ MIN_N_FLIP → lower flipCooldownMin one step
 * Otherwise measure-only.
 *
 * `flipStats` is optional; when absent the flip-cooldown is left untouched.
 */
export function decidePatch(
  stats: MethodStats | undefined,
  cfg: AutoConfig,
  flipStats?: MethodStats | null,
): { patch: Partial<AutoConfig> | null; kind: string; note: string } {
  if (!stats || stats.n < MIN_N_MEASURE) {
    return {
      patch: null,
      kind: "skip",
      note: `need ≥${MIN_N_MEASURE} closed on active method (have ${stats?.n ?? 0})`,
    };
  }

  const patch: Partial<AutoConfig> = {};
  const notes: string[] = [];
  let kind = "measure";

  // ── entry tuning ──────────────────────────────────────────────────────────
  if (stats.n >= MIN_N_TIGHTEN && stats.expectancy < 0) {
    const nextScore = Math.min(85, Math.round(cfg.minScore + 2));
    const nextAcc = Math.min(85, Math.round(cfg.minAcc + 1));
    const nextRisk = Math.max(10, cfg.riskPct <= 10 ? 10 : cfg.riskPct === 25 ? 10 : cfg.riskPct === 50 ? 25 : 10);
    if (nextScore !== cfg.minScore || nextAcc !== cfg.minAcc || nextRisk !== cfg.riskPct) {
      patch.minScore = nextScore;
      patch.minAcc = nextAcc;
      patch.riskPct = nextRisk as AutoConfig["riskPct"];
      notes.push(`tighten entry: exp ${stats.expectancy}% WR ${stats.winRate.toFixed(0)}% n=${stats.n} → minScore ${nextScore} minAcc ${nextAcc} risk ${nextRisk}%`);
      kind = "promote";
    }
  } else if (stats.n >= MIN_N_PROMOTE && stats.expectancy >= 0.3 && stats.winRate >= 48) {
    // mild restore only from 10 → 25, never jump to 50/100 automatically
    if (cfg.riskPct === 10) {
      patch.riskPct = 25;
      notes.push(`restore risk 10→25 · exp ${stats.expectancy}% WR ${stats.winRate.toFixed(0)}% n=${stats.n}`);
      kind = "promote";
    }
  }

  // ── flip-cooldown tuning — independent of entry, can fire alongside ───────
  // Flip has its own expectancy over its own sample. When flips lose on average
  // AND we have enough of them, raise flipCooldownMin one step (0→15→30→60).
  // When flips are healthy, lower one step toward 0. Stay within FLIP_COOLDOWN_CHOICES.
  if (flipStats && flipStats.n >= MIN_N_FLIP) {
    const idx = FLIP_COOLDOWN_CHOICES.indexOf(cfg.flipCooldownMin as (typeof FLIP_COOLDOWN_CHOICES)[number]);
    const cur = idx < 0 ? 0 : idx;
    if (flipStats.expectancy < 0 && cur < FLIP_COOLDOWN_CHOICES.length - 1) {
      const next = FLIP_COOLDOWN_CHOICES[cur + 1];
      patch.flipCooldownMin = next;
      notes.push(`flip churn bleed: exp ${flipStats.expectancy}% WR ${flipStats.winRate.toFixed(0)}% n=${flipStats.n} → flipCooldownMin ${cfg.flipCooldownMin}→${next}`);
      kind = "promote";
    } else if (flipStats.expectancy >= 0.3 && flipStats.winRate >= 48 && cur > 0) {
      const next = FLIP_COOLDOWN_CHOICES[cur - 1];
      patch.flipCooldownMin = next;
      notes.push(`flip edge healthy: exp ${flipStats.expectancy}% WR ${flipStats.winRate.toFixed(0)}% n=${flipStats.n} → flipCooldownMin ${cfg.flipCooldownMin}→${next}`);
      kind = "promote";
    }
  }

  if (Object.keys(patch).length === 0) {
    return {
      patch: null,
      kind: "measure",
      note: `tracking exp ${stats.expectancy}% WR ${stats.winRate.toFixed(0)}% n=${stats.n}`,
    };
  }
  return { patch, kind, note: notes.join(" · ") };
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
  const flipStats = await measureFlips();
  const decision = decidePatch(active, cfg, flipStats);

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
