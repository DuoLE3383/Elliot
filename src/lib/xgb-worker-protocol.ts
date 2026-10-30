// ─── XGB worker protocol — shared by the main thread (xgb-pool) and the worker
//
// Both sides import these TYPES only (erased at compile time), so the worker
// chunk never drags main-thread code in and vice versa.
//
//   main thread                          worker
//   ───────────                          ──────
//   {kind:"train", sym, itv,     ──────►  fetch klines (nếu chưa có) →
//    settings, difficulty?,               fetch run count (nếu chưa có) →
//    klines?}                             runXgb (120 cây + 22 engine sims)
//   ◄────── {kind:"progress", p}          (mỗi 15 cây)
//   ◄────── {kind:"done", res, entryPrice}   hoặc {kind:"fail", error}

import type { EngineSettings, Kline } from "./types";
import type { XgbResult } from "./xgb";

/** Main → worker: train one `${sym}-${itv}` combo. */
export interface XgbTrainRequest {
  kind: "train";
  /** monotonic id — routes progress/done/fail back to the right caller */
  id: number;
  sym: string;
  itv: string;
  settings: EngineSettings;
  /** pre-resolved difficulty level; omitted → worker fetches the run count itself */
  difficulty?: number;
  /** preloaded candles (single-train path); omitted → worker fetches `/api/klines` itself */
  klines?: Kline[];
}

/** Worker → main. */
export type XgbWorkerMsg =
  | { kind: "progress"; id: number; p: number }
  | { kind: "done"; id: number; sym: string; itv: string; res: XgbResult; entryPrice: number }
  | { kind: "fail"; id: number; sym: string; itv: string; error: string };
