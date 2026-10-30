// ─── XGB trainer Node worker (worker_threads) ────────────────────────────────
// Backend twin of the old browser Web Worker (src/workers/xgb.worker.ts): one
// combo per message — fetch klines straight from Binance (no HTTP self-call),
// train the gradient-boosted ensemble + the 22 engine sims of suggestFrom, ALL
// on a dedicated thread. Progress every 15 trees keeps the job bar alive.
//
// The whole xgb.ts dependency chain (indicators/market/papers/signals/
// wyck-features) is pure — no window/localStorage/fs — so it runs unchanged on
// Node. scripts/postbuild.mjs bundles THIS file with esbuild into
// .next/standalone/xgb-node.worker.mjs (standalone self-contained, no node_modules
// resolution needed); src/lib/xgb-pool-node.ts spawns it.
import { parentPort } from "node:worker_threads";
import { runXgb } from "../lib/xgb";
import { fetchKlinesDirect } from "../lib/klines-direct";
import type { XgbTrainRequest, XgbWorkerMsg } from "../lib/xgb-worker-protocol";

const port = parentPort;
if (!port) throw new Error("xgb-node.worker must run inside a worker_threads Worker");

port.on("message", async (msg: XgbTrainRequest) => {
  if (!msg || msg.kind !== "train") return;
  try {
    const klines = msg.klines ?? (await fetchKlinesDirect(msg.sym, msg.itv));
    const lv = msg.difficulty ?? 0;
    const res = await runXgb(klines, msg.settings, `${msg.sym}-${msg.itv}`, msg.itv, (p) => {
      port.postMessage({ kind: "progress", id: msg.id, p } satisfies XgbWorkerMsg);
    }, lv);
    // entry price = last CLOSED candle close — same convention everywhere
    const entryPrice = klines.length >= 2 ? klines[klines.length - 2].c : 0;
    port.postMessage({
      kind: "done",
      id: msg.id,
      sym: msg.sym,
      itv: msg.itv,
      res,
      entryPrice,
    } satisfies XgbWorkerMsg);
  } catch (err) {
    port.postMessage({
      kind: "fail",
      id: msg.id,
      sym: msg.sym,
      itv: msg.itv,
      error: err instanceof Error ? err.message : String(err),
    } satisfies XgbWorkerMsg);
  }
});
