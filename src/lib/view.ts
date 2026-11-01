// ─── view — payload của /api/view: MỌI thứ trang chính tính ở server ─────────
// "dọn hết những gì đang chạy trên web về chạy ở server trừ chart" — từ 0.2.35
// trình duyệt KHÔNG còn tính signalsFrom/papersFrom/wyckoffFrom/analyze/
// strategy-pies/session-stats/watch-status nữa. Nó chỉ:
//   • vẽ chart từ klines (/api/klines + SSE /api/stream — phần "trừ chart")
//   • poll /api/view 2s/lần và render JSON có sẵn dưới đây.
// Types sống ở lib riêng (không import server-only) để cả route lẫn client dùng
// chung mà không kéo db/engine vào bundle trình duyệt.

import type { Analysis } from "./analysis";
import type { CycleStats } from "./cycles";
import type { SessionStat, WhaleDelta } from "./market";
import type { KpiStats, PendingEntry } from "./papers";
import type { EngineSettings, Paper, Signal, WyckoffSettings } from "./types";
import type { WyckoffResult } from "./wyckoff";

/** WyckoffResult sau khi qua JSON: Int8Array → number[], EMA đã làm tròn. */
export type WyckoffView = Omit<WyckoffResult, "tints" | "emaF" | "emaS"> & {
  tints: number[];
  emaF: (number | null)[];
  emaS: (number | null)[];
};

/** Trạng thái một cặp trong watchlist — server tính từ mini-klines 48 nến. */
export type WatchStatus =
  | { kind: "loading" }
  | { kind: "wait" }
  | { kind: "signal"; side: "LONG" | "SHORT"; fresh: boolean };

/** Sparkline đã chuẩn hoá 0..1 (min-max) — client chỉ vẽ, không tính. */
export interface Sparkline {
  up: boolean;
  pts: number[];
}

export interface WatchRow {
  sym: string;
  status: WatchStatus;
  spark: Sparkline | null;
}

export type PieSliceKey = "tp" | "sl" | "liq" | "flip";
export interface PieSlice {
  key: PieSliceKey;
  n: number;
}
/** Một donut "Tiềm năng chiến lược" — server replay preset trên cùng nến. */
export interface PieStat {
  key: string;
  k: KpiStats;
  slices: PieSlice[];
}

export interface ViewPayload {
  at: number;
  symbol: string;
  interval: string;
  /** số nến server đã dùng tính (sub "n nến" của panel pies) */
  n: number;
  // ── engine (overlay chart + dock + journal) ────────────────────────────────
  signals: Signal[];
  /** tín hiệu ĐÃ XÁC NHẬN (nến đóng) — dock + rail context */
  confirmed: Signal[];
  sma: (number | null)[];
  stop: (number | null)[];
  trend: number[];
  papers: Paper[];
  open: Paper | null;
  pending: PendingEntry | null;
  kpi: KpiStats;
  /** cổng SMA hướng — chặn BUY khi giá dưới SMA, không chặn SELL */
  gate: { long: boolean; short: boolean; sma: number | null };
  wyckoff: WyckoffView | null;
  // ── phân tích & pies ───────────────────────────────────────────────────────
  analysis: Analysis;
  pies: PieStat[];
  // ── phiên + chu kỳ lịch ────────────────────────────────────────────────────
  sessStats: SessionStat[];
  whale: WhaleDelta | null;
  cycles: CycleStats | null;
  // ── watchlist ──────────────────────────────────────────────────────────────
  watch: WatchRow[];
}

/** Truy vấn /api/view — settings/wyckoff là object con (URL-encoded JSON). */
export interface ViewQuery {
  symbol: string;
  interval: string;
  s: Pick<
    EngineSettings,
    "slPct" | "tpPct" | "leverage" | "atrKey" | "atrPeriod" | "smaPeriod" | "smaFilter" | "utOn"
  >;
  w: Pick<WyckoffSettings, "enabled" | "mode" | "speed" | "sens" | "reqPhaseC">;
  pairs: string[];
}

/** Query string cho /api/view — object con được encodeURIComponent(JSON). */
export function viewQueryString(q: ViewQuery): string {
  const sp = new URLSearchParams({
    symbol: q.symbol,
    interval: q.interval,
    s: JSON.stringify(q.s),
    w: JSON.stringify(q.w),
    pairs: q.pairs.join(","),
  });
  return sp.toString();
}

/** fetch /api/view — trả null khi mạng/HTTP lỗi (caller giữ snapshot cũ). */
export async function fetchView(q: ViewQuery): Promise<ViewPayload | null> {
  try {
    const res = await fetch(`/api/view?${viewQueryString(q)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as ViewPayload;
  } catch {
    return null;
  }
}
