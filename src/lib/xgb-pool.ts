// ─── XgbPool — Web Worker pool for the in-browser XGB trainer ────────────────
//
// BEFORE: train-all was a sequential for-loop ON THE MAIN THREAD —
//         fetch klines → 120 trees → 22 engine sims → persist, one combo at a
//         time, with only a setTimeout(0) every 15 trees keeping the UI alive.
//         208 combos ≈ tens of minutes and a frozen page.
//
// AFTER:  combos queue up and `min(hardwareConcurrency−1, 6)` module workers
//         pull them — each worker fetches its own klines + run count and trains
//         fully off-thread, so network AND CPU scale out while the UI thread
//         only handles persistence + paint.
//
//         speedup ≈ pool width (e.g. 8-thread laptop → ~5-6× faster), and the
//         bigger the history/params grow, the more the parallelism pays off.
//
// Determinism is unchanged: runXgb is seeded per difficulty level, so results
// are byte-identical to the sequential path. Environments without Worker
// (old browsers, SSR edge cases) transparently fall back to the old sequential
// behavior — same results, same callbacks, just slower.

import { runXgb, type XgbResult } from "./xgb";
import type { EngineSettings } from "./types";
import type { XgbTrainRequest, XgbWorkerMsg } from "./xgb-worker-protocol";

export type TrainOutcome =
  | { ok: true; res: XgbResult; entryPrice: number }
  | { ok: false; error: string };

export interface QueueHooks {
  /** fired when a combo is actually DISPATCHED to a worker (not when queued) */
  onComboStart?: (sym: string, itv: string) => void;
  onComboDone?: (sym: string, itv: string, res: XgbResult, entryPrice: number) => void | Promise<void>;
  onComboFail?: (sym: string, itv: string, error: string) => void;
}

/** Pool width — leave one core for the UI thread; cap 6 (fetch pressure + RAM). */
export function xgbPoolSize(): number {
  if (typeof navigator === "undefined") return 1;
  const hc = navigator.hardwareConcurrency || 4;
  return Math.max(2, Math.min(6, hc - 1));
}

export function xgbWorkerSupported(): boolean {
  try {
    return typeof Worker !== "undefined" && typeof URL !== "undefined";
  } catch {
    return false;
  }
}

// tiny main-thread copies of the worker's fetch helpers — used ONLY by the
// sequential fallback (no-Worker environments)
async function fetchKlinesHttp(sym: string, itv: string): Promise<unknown[]> {
  const r = await fetch(`/api/klines?symbol=${encodeURIComponent(sym)}&interval=${itv}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { klines: unknown[] };
  return j.klines;
}

async function fetchRunCountHttp(sym: string, itv: string): Promise<number> {
  try {
    const r = await fetch(`/api/finetune?symbol=${encodeURIComponent(sym)}&interval=${itv}&limit=1&count=1`);
    if (!r.ok) return 0;
    const j = (await r.json()) as { count?: number };
    return typeof j.count === "number" ? j.count : 0;
  } catch {
    return 0;
  }
}

interface QueueItem {
  req: XgbTrainRequest;
  onProgress?: (p: number) => void;
  onStart?: () => void;
  resolve: (o: TrainOutcome) => void;
}

interface Pending {
  worker: Worker;
  onProgress?: (p: number) => void;
  resolve: (o: TrainOutcome) => void;
}

export class XgbPool {
  readonly size: number;
  private readonly fallback: boolean;
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: QueueItem[] = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private destroyed = false;

  constructor(size?: number) {
    this.size = Math.max(1, Math.min(6, size ?? xgbPoolSize()));
    this.fallback = !xgbWorkerSupported();
  }

  /** width actually usable (0 when workers are unavailable → sequential mode) */
  get parallelism(): number {
    return this.fallback ? 1 : this.size;
  }

  /** Train one combo. Resolves when the worker reports done/fail. */
  train(
    req: Omit<XgbTrainRequest, "kind" | "id">,
    onProgress?: (p: number) => void,
    onStart?: () => void,
  ): Promise<TrainOutcome> {
    const full: XgbTrainRequest = { ...req, kind: "train", id: this.nextId++ };
    if (this.fallback) {
      onStart?.();
      return this.runFallback(full, onProgress);
    }
    return new Promise<TrainOutcome>((resolve) => {
      if (this.destroyed) {
        resolve({ ok: false, error: "pool destroyed" });
        return;
      }
      this.queue.push({ req: full, onProgress, onStart, resolve });
      this.pump();
    });
  }

  /** Fire every combo through the pool; resolves when ALL have settled. */
  async runQueue(
    specs: { sym: string; itv: string; difficulty?: number; klines?: XgbTrainRequest["klines"] }[],
    settings: EngineSettings,
    hooks: QueueHooks,
  ): Promise<void> {
    await Promise.all(
      specs.map((s) =>
        this.train(
          { sym: s.sym, itv: s.itv, difficulty: s.difficulty, klines: s.klines, settings },
          undefined,
          () => hooks.onComboStart?.(s.sym, s.itv),
        ).then(async (out) => {
          if (out.ok) await hooks.onComboDone?.(s.sym, s.itv, out.res, out.entryPrice);
          else hooks.onComboFail?.(s.sym, s.itv, out.error);
        }),
      ),
    );
  }

  destroy(): void {
    this.destroyed = true;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.pending.clear();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private pump(): void {
    while (this.queue.length > 0) {
      const w = this.idle.pop() ?? (this.workers.length < this.size ? this.spawn() : null);
      if (!w) return; // every worker busy — wait for the next done/fail
      const job = this.queue.shift()!;
      this.dispatch(w, job);
    }
  }

  private spawn(): Worker {
    const w = new Worker(new URL("../workers/xgb.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<XgbWorkerMsg>) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.kind === "progress") {
        p.onProgress?.(m.p);
        return;
      }
      this.pending.delete(m.id);
      this.idle.push(w);
      p.resolve(m.kind === "done" ? { ok: true, res: m.res, entryPrice: m.entryPrice } : { ok: false, error: m.error });
      this.pump();
    };
    w.onerror = () => {
      // hard worker crash (OOM, script error outside try/catch) — fail every
      // job assigned to it and drop it from the pool; pump() re-spawns on demand
      for (const [id, p] of [...this.pending]) {
        if (p.worker !== w) continue;
        this.pending.delete(id);
        p.resolve({ ok: false, error: "worker crashed" });
      }
      this.workers = this.workers.filter((x) => x !== w);
      this.idle = this.idle.filter((x) => x !== w);
      this.pump();
    };
    this.workers.push(w);
    return w;
  }

  private dispatch(w: Worker, job: QueueItem): void {
    this.pending.set(job.req.id, { worker: w, onProgress: job.onProgress, resolve: job.resolve });
    job.onStart?.();
    w.postMessage(job.req);
  }

  private async runFallback(req: XgbTrainRequest, onProgress?: (p: number) => void): Promise<TrainOutcome> {
    try {
      const klines = (req.klines ?? (await fetchKlinesHttp(req.sym, req.itv))) as Parameters<typeof runXgb>[0];
      const lv = req.difficulty ?? (await fetchRunCountHttp(req.sym, req.itv));
      const res = await runXgb(klines, req.settings, `${req.sym}-${req.itv}`, req.itv, onProgress, lv);
      const entryPrice = klines.length >= 2 ? klines[klines.length - 2].c : 0;
      return { ok: true, res, entryPrice };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
