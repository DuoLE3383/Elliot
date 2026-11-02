// ─── XGB trainer Web Worker ──────────────────────────────────────────────────
// One combo per message: (optionally) fetch klines + run count, train the
// gradient-boosted ensemble + the 22 engine sims of suggestFrom — ALL off the
// main thread. Posting progress every 15 trees keeps the panel bar alive.
//
// The whole xgb.ts dependency chain (indicators/market/papers/signals/
// wyck-features) is pure — no window/localStorage — so it runs unchanged here.

import { runXgb } from "../lib/xgb";
import type { Kline } from "../lib/types";
import type { XgbTrainRequest, XgbWorkerMsg } from "../lib/xgb-worker-protocol";

const ctx = self as unknown as {
  postMessage: (m: XgbWorkerMsg) => void;
  onmessage: ((e: MessageEvent<XgbTrainRequest>) => void) | null;
};

async function fetchKlines(sym: string, itv: string): Promise<Kline[]> {
  const r = await fetch(`/api/klines?symbol=${encodeURIComponent(sym)}&interval=${itv}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { klines: Kline[] };
  return j.klines;
}

async function fetchRunCount(sym: string, itv: string): Promise<number> {
  try {
    const r = await fetch(`/api/finetune?symbol=${encodeURIComponent(sym)}&interval=${itv}&limit=1&count=1`);
    if (!r.ok) return 0;
    const j = (await r.json()) as { count?: number };
    return typeof j.count === "number" ? j.count : 0;
  } catch {
    return 0;
  }
}

ctx.onmessage = async (e: MessageEvent<XgbTrainRequest>) => {
  const msg = e.data;
  if (!msg || msg.kind !== "train") return;
  try {
    const klines = msg.klines ?? (await fetchKlines(msg.sym, msg.itv));
    const lv = msg.difficulty ?? (await fetchRunCount(msg.sym, msg.itv));
    const res = await runXgb(klines, msg.settings, `${msg.sym}-${msg.itv}`, msg.itv, (p) => {
      ctx.postMessage({ kind: "progress", id: msg.id, p });
    }, lv);
    // entry price = last CLOSED candle close — same convention as the old
    // main-thread persistXgbResult (which read ks[ks.length - 2].c)
    const entryPrice = klines.length >= 2 ? klines[klines.length - 2].c : 0;
    ctx.postMessage({ kind: "done", id: msg.id, sym: msg.sym, itv: msg.itv, res, entryPrice });
  } catch (err) {
    ctx.postMessage({
      kind: "fail",
      id: msg.id,
      sym: msg.sym,
      itv: msg.itv,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
