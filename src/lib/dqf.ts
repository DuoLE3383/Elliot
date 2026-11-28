// ─── DQF — DYNAMIC QUALITY FLOOR (0.3.2) — "learn & evolve from whole Elliott session" ──
// User requirement: "AUC ACC and score dynamic and must learn and evolve based on
// whole Elliott session and state it clearly in stats".
//
// Design:
//   • LEARNING SOURCE = AutoTrade table (Book B Elliott) ALL closed trades — each trade
//     saved auc/acc/score AT ENTRY (engine wrote from day one) + pnlPct (leveraged ROI,
//     net of fees). Learn from REAL results of this session, not from manual setpoints.
//   • RULE (break-even bands, pure numbers no LLM):
//       – Split trades by entry-value band (Score 60→85 · AUC 0.80→0.90 ·
//         ACC 70→85, step 2/0.01/1). For each rising threshold F, measure cumulative
//         expectancy of entry ≥ F group.
//       – Target per metric = SMALLEST threshold F whose ≥ F group has expectancy ≥ 0
//         (and enough samples ≥ DQF_MIN_BAND_N). No threshold positive → cap (85/0.90/
//         85). All groups positive → default (50/0.60/55) — v0.3.45. Not enough samples → keep.
//   • EVOLUTION = move one STEP (score ±2 · AUC ±0.01 · ACC ±1) toward target,
//     at most 1 change per DQF_COOLDOWN_MIN minutes — smooth, traceable, no
//     cfg panel jump. Absolute bounds [50..85]/[0.60..0.90]/[55..85] — NEVER
//     below default (keeps tune-2 0.3.0 restore rule consistent).
//   • APPLY = engine reads effective floors at funnel entry + flip (override layer,
//     does NOT write cfg → no more 0.2.99 sync loop and no manual
//     self-improve/tune-2 install). Panel + tooltip 0.3.1 use these effective floors.
//   • STATE CLEARLY = DATA_DIR/dqf-state.json (survives restart): current floors +
//     target + reason with numbers + evidence bands + history of each change.
//     /stats station "Dynamic quality floor (Elliott)" reads FILE (does not touch DB —
//     integrity_check lesson: poll must not scan DB).
//
// Rival with self-improve agent (auto +2 minScore into cfg): when DQF on, effective
// floors belong to DQF — agent cfg patch still writes but is overridden at funnel.
// /stats shows "source" so you can see who holds authority.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { db } from "./db";
import { dataFile } from "./data-dir";

// ── Rule constants ──────────────────────────────────────────────────────────────

/** default floors (setpoint broadcast 31/10) — absolute LOWER bound of DQF */
export const DQF_DEFAULT = { minScore: 50, minAuc: 0.6, minAcc: 55 } as const; // v0.3.45: lowered lower bound 60/0.80/70 -> 50/0.60/55 — 60/0.80/70 gave 0/336 tradeable, bot dead
/** absolute UPPER bound — matches self-improve/tune-2 cap */
export const DQF_CAP = { minScore: 85, minAuc: 0.9, minAcc: 85 } as const;
/** one evolution step per change */
export const DQF_STEP = { minScore: 2, minAuc: 0.01, minAcc: 1 } as const;
/** min closed trades of WHOLE session before it may speak */
export const DQF_MIN_N = 20;
/** min trades in cumulative group ≥ F for that group to be trusted */
export const DQF_MIN_BAND_N = 10;
/** re-measure session at most every 5 min (engine tick + stats both read cache) */
const DQF_MEASURE_TTL_MS = 5 * 60_000;
/** at most 1 floor change every 30 min — smooth evolution, no jump */
export const DQF_COOLDOWN_MIN = 30;

// ── Types (client reads via /api/stats + /api/engine) ─────────────────────

export interface DqfBand {
  /** range [lo, hi) — hi = Infinity for last band */
  lo: number;
  hi: number;
  n: number;
  wr: number;
  exp: number;
}

export interface DqfFloors {
  minScore: number;
  minAuc: number;
  minAcc: number;
}

export interface DqfSession {
  n: number;
  wr: number;
  payoff: number;
  /** expectancy % ROI / trade (avg pnlPct) — same formula as tune-2 */
  exp: number;
  net: number;
}

export interface DqfDecision {
  at: number;
  on: boolean;
  /** EFFECTIVE floors this cycle — "cfg" = not enough samples/off → passthrough panel config */
  src: "dqf" | "cfg";
  floors: DqfFloors;
  /** band-derived target — null = not enough group samples */
  target: DqfFloors | null;
  /** reason with NUMBERS — shown in /stats + engine log */
  why: string;
  session: DqfSession;
  /** evidence: cumulative expectancy per entry band */
  bands: { score: DqfBand[]; auc: DqfBand[]; acc: DqfBand[] };
}

export interface DqfHistEntry {
  at: number;
  from: DqfFloors;
  to: DqfFloors;
  why: string;
}

export interface DqfFile {
  on: boolean;
  state: DqfDecision | null;
  /** EVOLUTION history — one line per floor step (newest first) */
  hist: DqfHistEntry[];
  lastChangeAt: number | null;
}

// ── Evidence bands (fixed, cover all eras — incl. old 0.55/55 floor era) ────

const SCORE_BANDS: [number, number][] = [[0, 55], [55, 60], [60, 65], [65, 70], [70, 75], [75, 80], [80, Infinity]];
const AUC_BANDS: [number, number][] = [[0, 0.7], [0.7, 0.75], [0.75, 0.8], [0.8, 0.85], [0.85, Infinity]];
const ACC_BANDS: [number, number][] = [[0, 55], [55, 60], [60, 65], [65, 70], [70, 75], [75, Infinity]];

/** floor candidates increasing in [default..cap] — exact evolution steps */
export const DQF_CANDIDATES = {
  minScore: rangeCandidates(DQF_DEFAULT.minScore, DQF_CAP.minScore, DQF_STEP.minScore),
  minAuc: rangeCandidates(DQF_DEFAULT.minAuc, DQF_CAP.minAuc, DQF_STEP.minAuc, 2),
  minAcc: rangeCandidates(DQF_DEFAULT.minAcc, DQF_CAP.minAcc, DQF_STEP.minAcc),
};

function rangeCandidates(lo: number, hi: number, step: number, round = 0): number[] {
  const out: number[] = [];
  const r = (v: number): number => Math.round(v * 10 ** round) / 10 ** round;
  for (let v = lo; r(v) < hi; v += step) out.push(r(v));
  out.push(hi);
  return out;
}

// ── Measure session from DB (only engine tick calls — stats reads file) ───────────────────

interface TradeRow {
  pnlPct: number | null;
  auc: number | null;
  acc: number | null;
  score: number | null;
}

function sessionStats(rows: TradeRow[]): DqfSession {
  const n = rows.length;
  const wins = rows.filter((r) => (r.pnlPct ?? 0) > 0).length;
  const avgWin = rows.filter((r) => (r.pnlPct ?? 0) > 0).reduce((a, r) => a + (r.pnlPct ?? 0), 0) / Math.max(1, wins);
  const losses = rows.filter((r) => (r.pnlPct ?? 0) <= 0);
  const avgLoss = losses.reduce((a, r) => a + (r.pnlPct ?? 0), 0) / Math.max(1, losses.length);
  const net = rows.reduce((a, r) => a + (r.pnlPct ?? 0), 0);
  const payoff = losses.length > 0 && wins > 0 ? avgWin / Math.abs(avgLoss) : wins > 0 ? Infinity : 0;
  return { n, wr: n ? (wins / n) * 100 : 0, payoff, exp: n ? net / n : 0, net };
}

function bandStats(rows: TradeRow[], pick: (r: TradeRow) => number | null, bands: [number, number][]): DqfBand[] {
  return bands.map(([lo, hi]) => {
    const inBand = rows.filter((r) => {
      const v = pick(r);
      return v != null && v >= lo && v < hi;
    });
    const s = sessionStats(inBand);
    return { lo, hi, n: s.n, wr: s.wr, exp: s.exp };
  });
}

/** CUMULATIVE expectancy of entry ≥ F group (within candidate range) */
function cumExp(rows: TradeRow[], pick: (r: TradeRow) => number | null, f: number): { n: number; exp: number } {
  const cum = rows.filter((r) => {
    const v = pick(r);
    return v != null && v >= f;
  });
  const s = sessionStats(cum);
  return { n: s.n, exp: s.exp };
}

/** Target for ONE metric: SMALLEST threshold F whose ≥ F group has expectancy ≥ 0 & enough samples.
 *  Returns: { to, why } · "cap" (no threshold positive) · "default" · null (not enough group samples). */
export function dqfTargetOne(
  rows: TradeRow[],
  pick: (r: TradeRow) => number | null,
  candidates: number[],
): { kind: "to" | "cap" | "default"; to: number; why: string } | null {
  // lowest band (entry < default) already positive → all thresholds positive → default
  const below = rows.filter((r) => {
    const v = pick(r);
    return v != null && v < candidates[0];
  });
  const belowS = sessionStats(below);
  if (below.length >= DQF_MIN_BAND_N && belowS.exp >= 0) {
    return { kind: "default", to: candidates[0], why: `below-default group also positive (exp ${fmt2(belowS.exp)}%, n=${below.length})` };
  }
  for (const f of candidates) {
    const { n, exp } = cumExp(rows, pick, f);
    if (n >= DQF_MIN_BAND_N && exp >= 0) {
      return { kind: "to", to: f, why: `group ≥ ${fmtNum(f, candidates)} break-even (exp ${fmt2(exp)}%, n=${n})` };
    }
  }
  // no threshold positive but some have enough samples → cap (keep only strongest zone)
  const anyN = candidates.some((f) => cumExp(rows, pick, f).n >= DQF_MIN_BAND_N);
  if (anyN) {
    const top = candidates[candidates.length - 1];
    const { n, exp } = cumExp(rows, pick, top);
    return { kind: "cap", to: top, why: `still negative at highest threshold (group ≥ ${fmtNum(top, candidates)}: exp ${fmt2(exp)}%, n=${n})` };
  }
  return null; // not enough samples per group — keep as is
}

const fmt2 = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
const fmtNum = (v: number, cands: number[]): string => (cands.length && cands[0] < 1 ? v.toFixed(2) : String(Math.round(v)));

const r2 = (v: number): number => Math.round(v * 100) / 100;

// ── EVOLUTION RULE — pure, exported for test ─────────────────────────────────

const clampFloors = (f: DqfFloors): DqfFloors => ({
  minScore: Math.min(DQF_CAP.minScore, Math.max(DQF_DEFAULT.minScore, Math.round(f.minScore))),
  minAuc: r2(Math.min(DQF_CAP.minAuc, Math.max(DQF_DEFAULT.minAuc, f.minAuc))),
  minAcc: Math.min(DQF_CAP.minAcc, Math.max(DQF_DEFAULT.minAcc, Math.round(f.minAcc))),
});

/** one evolution step: each metric moves AT MOST 1 step toward target (clamp bounds) */
export function dqfStepToward(current: DqfFloors, target: DqfFloors): { floors: DqfFloors; changed: boolean } {
  const step1 = (cur: number, tgt: number, stp: number): number =>
    Math.abs(tgt - cur) <= stp ? tgt : cur + Math.sign(tgt - cur) * stp;
  const next = clampFloors({
    minScore: step1(current.minScore, target.minScore, DQF_STEP.minScore),
    minAuc: r2(step1(current.minAuc, target.minAuc, DQF_STEP.minAuc)),
    minAcc: step1(current.minAcc, target.minAcc, DQF_STEP.minAcc),
  });
  const changed = next.minScore !== current.minScore || next.minAuc !== current.minAuc || next.minAcc !== current.minAcc;
  return { floors: next, changed };
}

// ── Persist (DATA_DIR/dqf-state.json — survives restart) ──────────────────

const DQF_FILE = "dqf-state.json";

export function readDqfFile(): DqfFile {
  try {
    const f = dataFile(DQF_FILE);
    if (!existsSync(f)) return { on: true, state: null, hist: [], lastChangeAt: null };
    const raw = JSON.parse(readFileSync(f, "utf8")) as Partial<DqfFile>;
    // JSON turns Infinity into null on save — restore it for the last band of each metric,
    // otherwise labels render as 80-null / 0.85-null / 75-null.
    const st = raw.state ?? null;
    if (st?.bands) {
      for (const k of ["score", "auc", "acc"] as const) {
        for (const b of st.bands[k] ?? []) {
          if ((b as unknown as { hi: unknown }).hi == null) (b as unknown as { hi: number }).hi = Infinity;
        }
      }
    }
    return { on: raw.on !== false, state: st, hist: Array.isArray(raw.hist) ? raw.hist : [], lastChangeAt: raw.lastChangeAt ?? null };
  } catch {
    return { on: true, state: null, hist: [], lastChangeAt: null };
  }
}

export function saveDqfFile(f: DqfFile): void {
  try {
    const file = dataFile(DQF_FILE);
    mkdirSync(dataFile("."), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...f, hist: f.hist.slice(0, 50) }, null, 2) + "\n", "utf8");
  } catch (e) {
    console.warn(`[dqf] save failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Switch /stats — keep hist + state, only change `on`. */
export function setDqfOn(on: boolean): DqfFile {
  const f = readDqfFile();
  const next: DqfFile = { ...f, on };
  saveDqfFile(next);
  console.log(`[dqf] dynamic quality floor ${on ? "ON" : "OFF"} — ${on ? "engine uses learned floors (when enough samples)" : "engine falls back to cfg panel floors"}`);
  return next;
}

// ── Measure cache (1 DB query / 5 min max — engine tick + snapshot share it) ─

let measureCache: { at: number; rows: TradeRow[] } | null = null;

async function measureSession(): Promise<TradeRow[]> {
  if (measureCache && Date.now() - measureCache.at < DQF_MEASURE_TTL_MS) return measureCache.rows;
  const rows = await db.autoTrade.findMany({
    where: { status: "closed", pnlPct: { not: null } },
    select: { pnlPct: true, auc: true, acc: true, score: true },
  });
  measureCache = { at: Date.now(), rows };
  return rows;
}

/** pure decision from measured rows — exported for test (no DB/fs) */
export function dqfDecide(
  rows: TradeRow[],
  cfgFloors: DqfFloors,
  prev: { floors: DqfFloors; lastChangeAt: number | null; on: boolean },
  now = Date.now(),
): { decision: DqfDecision; hist: DqfHistEntry | null } {
  const session = sessionStats(rows);
  const bands = {
    score: bandStats(rows, (r) => r.score, SCORE_BANDS),
    auc: bandStats(rows, (r) => r.auc, AUC_BANDS),
    acc: bandStats(rows, (r) => r.acc, ACC_BANDS),
  };
  const base: DqfDecision = {
    at: now,
    on: prev.on,
    src: "cfg",
    // passthrough cfg panel VERBATIM (user may set outside DQF bounds
    // DQF — clamp only applies to DQF-evolved floors)
    floors: { ...cfgFloors },
    target: null,
    why: "",
    session,
    bands,
  };
  if (!prev.on) {
    return { decision: { ...base, why: "switch OFF — passthrough cfg panel floors" }, hist: null };
  }
  if (session.n < DQF_MIN_N) {
    return {
      decision: { ...base, why: `not enough samples (n=${session.n} < ${DQF_MIN_N} closed trades) — keep cfg panel floors` },
      hist: null,
    };
  }
  const tScore = dqfTargetOne(rows, (r) => r.score, DQF_CANDIDATES.minScore);
  const tAuc = dqfTargetOne(rows, (r) => r.auc, DQF_CANDIDATES.minAuc);
  const tAcc = dqfTargetOne(rows, (r) => r.acc, DQF_CANDIDATES.minAcc);
  if (!tScore && !tAuc && !tAcc) {
    return {
      decision: {
        ...base,
        why: `not enough samples per group (n=${session.n}, need ≥ ${DQF_MIN_BAND_N} trades/group) — keep cfg panel floors`,
      },
      hist: null,
    };
  }
  const target = clampFloors({
    minScore: tScore ? tScore.to : cfgFloors.minScore,
    minAuc: tAuc ? tAuc.to : cfgFloors.minAuc,
    minAcc: tAcc ? tAcc.to : cfgFloors.minAcc,
  });
  const current = clampFloors(prev.floors);
  const inCooldown = prev.lastChangeAt != null && now - prev.lastChangeAt < DQF_COOLDOWN_MIN * 60_000;
  const { floors, changed } = dqfStepToward(current, target);
  // cooldown running → KEEP current floors (no silent step without log);
  // only when cooldown ends and target differs, step 1 and log history
  const eff = changed && !inCooldown ? floors : current;
  const src: "dqf" | "cfg" = "dqf";
  const targetNote = [
    tScore ? `Score→${Math.round(tScore.to)} (${tScore.why})` : null,
    tAuc ? `AUC→${tAuc.to.toFixed(2)} (${tAuc.why})` : null,
    tAcc ? `ACC→${Math.round(tAcc.to)} (${tAcc.why})` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const why = `session ${session.n} trades · WR ${session.wr.toFixed(2)}% · exp ${fmt2(session.exp)}%/trade — target: ${targetNote}${inCooldown ? " · waiting cooldown to step" : ""}`;
  let hist: DqfHistEntry | null = null;
  if (changed && !inCooldown) {
    hist = { at: now, from: current, to: floors, why: `evolved 1 step toward band target — exp ${fmt2(session.exp)}% (n=${session.n}, WR ${session.wr.toFixed(2)}%)` };
  }
  return { decision: { ...base, src, floors: eff, target, why }, hist };
}

/** TICK — engine calls once per entry cycle: measure → decide → persist → return effective floors */
export async function dqfTick(cfgFloors: DqfFloors): Promise<DqfFloors & { src: "dqf" | "cfg"; why: string; on: boolean }> {
  const f = readDqfFile();
  let rows: TradeRow[];
  try {
    rows = await measureSession();
  } catch (e) {
    console.warn(`[dqf] measure failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ...cfgFloors, src: "cfg", why: "measure failed — passthrough cfg", on: f.on };
  }
  const { decision, hist } = dqfDecide(rows, cfgFloors, {
    floors: f.state?.floors ?? cfgFloors,
    lastChangeAt: f.lastChangeAt,
    on: f.on,
  });
  const nextFile: DqfFile = {
    on: f.on,
    state: decision,
    lastChangeAt: hist ? hist.at : f.lastChangeAt,
    hist: hist ? [hist, ...f.hist] : f.hist,
  };
  saveDqfFile(nextFile);
  if (hist) {
    console.log(
      `[dqf] EVOLVED floors: Score ${hist.from.minScore}→${hist.to.minScore} · AUC ${hist.from.minAuc.toFixed(2)}→${hist.to.minAuc.toFixed(2)} · ACC ${hist.from.minAcc}→${hist.to.minAcc} — ${hist.why}`,
    );
  }
  return decision.on
    ? { ...decision.floors, src: decision.src, why: decision.why, on: decision.on }
    : { ...cfgFloors, src: "cfg", why: decision.why, on: decision.on };
}

/** SYNC — for engineSnapshot/panel (DO NOT touch DB): read cache file, 30s TTL
 *  old state still usable (just display of effective floors from last tick). */
let snapCache: { at: number; floors: DqfFloors & { src: "dqf" | "cfg"; why: string; on: boolean } } | null = null;

export function dqfEffectiveSync(cfgFloors: DqfFloors): DqfFloors & { src: "dqf" | "cfg"; why: string; on: boolean } {
  if (snapCache && Date.now() - snapCache.at < 30_000) return snapCache.floors;
  const f = readDqfFile();
  const out = f.on && f.state && f.state.src === "dqf"
    ? { ...f.state.floors, src: "dqf" as const, why: f.state.why, on: true }
    : // passthrough cfg verbatim — no DQF bound clamp
      { ...cfgFloors, src: "cfg" as const, why: f.state?.why ?? "", on: f.on };
  snapCache = { at: Date.now(), floors: out };
  return out;
}

// PATCH 3-TRACK + OLYMPUS
export const DQF_TRACKS = { ATHENA: { minScore: 70, minAuc: 0.80, minAcc: 78 }, HERCULES: { minScore: 60, minAuc: 0.74, minAcc: 72 }, ZEUS: { minScore: 55, minAuc: 0.72, minAcc: 68 }, OLYMPUS: { minScore: 60, minAuc: 0.74, minAcc: 72 } } as const;
export const DQF_PROMOTE_EVERY = 100;
export function dqfPromoteScore(e:number,w:number,d:number){ return e*100 + w*0.5 - d*2; }
