// ─── XgbPoolNode — worker_threads pool for the BACKEND XGB trainer ───────────
// Server twin of the browser pool (deleted src/lib/xgb-pool.ts): combos queue
// up and `min(cores−1, 6)` Node workers pull them — REAL parallelism on the
// VPS, no browser tab involved. The worker file (.next/standalone/
// xgb-node.worker.mjs) is bundled by postbuild with esbuild; when it's missing
// (dev mode, exotic CI) the pool transparently falls back to sequential
// in-process training — same results, same callbacks, just slower.
//
// Determinism is unchanged from the browser path: runXgb is seeded per
// difficulty level, so results are identical to the sequential loop.

import { Worker } from "node:worker_threads";
import os from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { runXgb, type XgbResult } from "./xgb";
import { fetchKlinesDirect } from "./klines-direct";
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

/** Pool width — leave one core for the server itself; cap 6 (fetch + RAM). XGB_WORKERS env overrides. */
export function xgbPoolSize(): number {
  const env = Number(process.env.XGB_WORKERS);
  if (Number.isFinite(env) && env >= 1) return Math.min(6, Math.floor(env));
  const cores = os.cpus()?.length ?? 4;
  return Math.max(2, Math.min(6, cores - 1));
}

/** The esbuild-bundled worker (postbuild) — probed from the usual boot cwds. */
function workerFile(): string | null {
  const candidates = [
    path.join(process.cwd(), "xgb-node.worker.mjs"),
    path.join(process.cwd(), ".next", "standalone", "xgb-node.worker.mjs"),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      // unreadable path — try the next
    }
  }
  return null;
}

export function xgbPoolAvailable(): boolean {
  return workerFile() != null;
}

interface QueueItem {
  req: XgbTrainRequest;
  resolve: (o: TrainOutcome) => void;
}

interface Pending {
  worker: Worker;
  resolve: (o: TrainOutcome) => void;
}

export class XgbPoolNode {
  readonly size: number;
  readonly file: string | null;
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: QueueItem[] = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private destroyed = false;

  constructor(size?: number) {
    this.size = Math.max(1, Math.min(6, size ?? xgbPoolSize()));
    this.file = workerFile();
  }

  /** width actually usable (1 = sequential in-process fallback) */
  get parallelism(): number {
    return this.file ? this.size : 1;
  }

  /** Train one combo. Resolves when the worker reports done/fail. */
  train(
    req: Omit<XgbTrainRequest, "kind" | "id">,
    onStart?: () => void,
  ): Promise<TrainOutcome> {
    const full: XgbTrainRequest = { ...req, kind: "train", id: this.nextId++ };
    if (!this.file || this.destroyed) {
      onStart?.();
      return this.runInline(full);
    }
    return new Promise<TrainOutcome>((resolve) => {
      if (this.destroyed) {
        resolve({ ok: false, error: "pool destroyed" });
        return;
      }
      this.queue.push({ req: full, resolve });
      this.pump(onStart);
    });
  }

  /** Fire every combo through the pool; resolves when ALL have settled. */
  async runQueue(
    specs: { sym: string; itv: string; difficulty?: number }[],
    settings: EngineSettings,
    hooks: QueueHooks,
  ): Promise<void> {
    await Promise.all(
      specs.map((s) =>
        this.train(
          { sym: s.sym, itv: s.itv, difficulty: s.difficulty, settings },
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
    for (const w of this.workers) void w.terminate();
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.pending.clear();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private pump(notifyStart?: () => void): void {
    while (this.queue.length > 0) {
      const w = this.idle.pop() ?? (this.workers.length < this.size ? this.spawn() : null);
      if (!w) return; // every worker busy — wait for the next done/fail
      const job = this.queue.shift()!;
      notifyStart?.();
      this.dispatch(w, job);
    }
  }

  private spawn(): Worker {
    const w = new Worker(this.file!);
    w.on("message", (m: XgbWorkerMsg) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.kind === "progress") return; // per-combo progress — pool stays cheap
      this.pending.delete(m.id);
      this.idle.push(w);
      p.resolve(m.kind === "done" ? { ok: true, res: m.res, entryPrice: m.entryPrice } : { ok: false, error: m.error });
      this.pump();
    });
    w.on("error", (err) => {
      // hard worker crash (OOM, script error outside try/catch) — fail every
      // job assigned to it and drop it from the pool; pump() re-spawns on demand
      for (const [id, p] of [...this.pending]) {
        if (p.worker !== w) continue;
        this.pending.delete(id);
        p.resolve({ ok: false, error: err instanceof Error ? `worker crashed: ${err.message}` : "worker crashed" });
      }
      this.workers = this.workers.filter((x) => x !== w);
      this.idle = this.idle.filter((x) => x !== w);
      this.pump();
    });
    this.workers.push(w);
    return w;
  }

  private dispatch(w: Worker, job: QueueItem): void {
    this.pending.set(job.req.id, { worker: w, resolve: job.resolve });
    w.postMessage(job.req);
  }

  /** Sequential fallback — no worker bundle (dev mode). Same math, one core. */
  private async runInline(req: XgbTrainRequest): Promise<TrainOutcome> {
    try {
      const klines = req.klines ?? (await fetchKlinesDirect(req.sym, req.itv));
      const lv = req.difficulty ?? 0;
      const res = await runXgb(klines, req.settings, `${req.sym}-${req.itv}`, req.itv, undefined, lv);
      const entryPrice = klines.length >= 2 ? klines[klines.length - 2].c : 0;
      return { ok: true, res, entryPrice };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
