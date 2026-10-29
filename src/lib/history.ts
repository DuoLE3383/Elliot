// ─── Suggestion & finetune history — shared client/server types + helpers ───
// The terminal persists every XGBoost train run (finetune) and its strategy
// suggestion per (pair, interval, time) to SQLite via /api/suggestions and
// /api/finetune. Outcomes are scored once the prediction horizon expires.

export type XgbBiasRow = "LONG" | "SHORT" | "NEUTRAL";
export type Outcome = "win" | "loss" | "flat";

/** A saved strategy suggestion (one row per train per pair per time). */
export interface SuggestionRow {
  id: string;
  symbol: string;
  interval: string;
  bias: XgbBiasRow;
  prob: number;
  confidence: number;
  slPct: number;
  tpPct: number;
  atrKey: number;
  atrPeriod: number;
  smaFilter: boolean;
  smaPeriod: number;
  /** model accuracy at train time, % */
  acc: number;
  /** model AUC at train time, 0..1 */
  auc: number;
  horizonBars: number;
  entryPrice: number;
  applied: boolean;
  /** null = horizon not reached yet */
  outcome: Outcome | null;
  exitPrice: number | null;
  pnlPct: number | null;
  resolvedAt: string | null;
  createdAt: string;
}

/** A saved XGBoost train / finetune run. */
export interface RunRow {
  id: string;
  symbol: string;
  interval: string;
  kind: "train" | "finetune";
  samples: number;
  valSamples: number;
  acc: number;
  auc: number;
  logloss: number;
  trees: number;
  horizon: number;
  importance: { name: string; gain: number }[];
  applied: boolean;
  createdAt: string;
}

/** Bar duration in ms per supported timeframe (mirrors Binance intervals). */
export const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

/** When the outcome of a suggestion can be scored: createdAt + horizon bars. */
export function resolveDeadline(s: Pick<SuggestionRow, "createdAt" | "horizonBars" | "interval">): number {
  return new Date(s.createdAt).getTime() + s.horizonBars * (INTERVAL_MS[s.interval] ?? 300_000);
}

/** Signed % move in the suggested direction (LONG up = win, SHORT down = win). */
export function directionalPnl(bias: XgbBiasRow, entry: number, exit: number): number {
  if (!entry || !exit) return 0;
  const raw = bias === "SHORT" ? ((entry - exit) / entry) * 100 : ((exit - entry) / entry) * 100;
  return Math.round(raw * 100) / 100;
}

export function outcomeOf(bias: XgbBiasRow, entry: number, exit: number): Outcome {
  if (bias === "NEUTRAL") return "flat";
  const pnl = directionalPnl(bias, entry, exit);
  return pnl > 0 ? "win" : pnl < 0 ? "loss" : "flat";
}

// ─── Client helpers (fetch wrappers) ─────────────────────────────────────────

const jsonHeaders = { "Content-Type": "application/json" };

export async function fetchSuggestions(params: { symbol?: string; interval?: string; limit?: number }): Promise<SuggestionRow[]> {
  const q = new URLSearchParams();
  if (params.symbol) q.set("symbol", params.symbol);
  if (params.interval) q.set("interval", params.interval);
  q.set("limit", String(params.limit ?? 100));
  const res = await fetch(`/api/suggestions?${q.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { suggestions: SuggestionRow[] };
  return json.suggestions;
}

export async function saveSuggestion(payload: Omit<SuggestionRow, "id" | "applied" | "appliedAt" | "outcome" | "exitPrice" | "pnlPct" | "resolvedAt" | "createdAt">): Promise<SuggestionRow | null> {
  try {
    const res = await fetch("/api/suggestions", { method: "POST", headers: jsonHeaders, body: JSON.stringify(payload) });
    if (!res.ok) return null;
    const json = (await res.json()) as { suggestion: SuggestionRow };
    return json.suggestion;
  } catch {
    return null;
  }
}

export async function saveRun(payload: {
  symbol: string;
  interval: string;
  samples: number;
  valSamples: number;
  acc: number;
  auc: number;
  logloss: number;
  trees: number;
  horizon: number;
  importance: { name: string; gain: number }[];
  params?: unknown;
}): Promise<RunRow | null> {
  try {
    const res = await fetch("/api/finetune", { method: "POST", headers: jsonHeaders, body: JSON.stringify(payload) });
    if (!res.ok) return null;
    const json = (await res.json()) as { run: RunRow };
    return json.run;
  } catch {
    return null;
  }
}

export async function fetchRuns(params: { symbol?: string; interval?: string; limit?: number }): Promise<RunRow[]> {
  const q = new URLSearchParams();
  if (params.symbol) q.set("symbol", params.symbol);
  if (params.interval) q.set("interval", params.interval);
  q.set("limit", String(params.limit ?? 20));
  const res = await fetch(`/api/finetune?${q.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { runs: RunRow[] };
  return json.runs;
}

export async function markApplied(kind: "suggestion" | "run", id: string): Promise<boolean> {
  try {
    const res = await fetch(kind === "suggestion" ? "/api/suggestions" : "/api/finetune", {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ id, action: "apply" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ask the server to score every pending suggestion whose horizon has elapsed. */
export async function resolveBatch(prices: Record<string, number>): Promise<number> {
  try {
    const res = await fetch("/api/suggestions", {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ action: "resolve-batch", prices }),
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { resolved: number };
    return json.resolved;
  } catch {
    return 0;
  }
}
