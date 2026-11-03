// ─── engine-jobs — single-flight FIFO job lanes for the backend engine ───────
// "Nếu nhiều người ấn chạy thì bắt chờ": every heavy operation (scan / train /
// universe) runs in ONE server lane per kind. The first click runs; further
// clicks JOIN the queue and see their waiting position. Identical queued jobs
// (same kind + signature, e.g. two users hitting "Train all" back-to-back)
// coalesce into one — running the same 208 combos twice in a row helps nobody.
// State lives on globalThis (survives dev-mode module reloads) and is exposed
// through GET /api/engine so any number of tabs/devices see the same truth.

export type JobKind = "scan" | "train" | "universe";

export interface JobProgress {
  done: number;
  total: number;
  current: string;
}

export interface JobView {
  id: string;
  kind: JobKind;
  /** human signature — "all" or "single:ADAUSDT 1h" */
  label: string;
  state: "queued" | "running" | "done" | "failed";
  /** 0 = running/next up, 1.. = waiting behind that many jobs */
  position: number;
  progress: JobProgress | null;
  /** free-form result data (train: saved/best/result; scan: rows count…) */
  extra: Record<string, unknown>;
  error?: string;
  startedAt: number | null;
  finishedAt: number | null;
}

interface Job {
  id: string;
  kind: JobKind;
  label: string;
  fn: (report: (patch: { progress?: JobProgress; extra?: Record<string, unknown> }) => void) => Promise<Record<string, unknown>>;
  view: JobView;
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  /** extra views of the same coalesced job — resolved together */
  joined: ((v: Record<string, unknown>) => void)[];
}

interface Lane {
  current: Job | null;
  queue: Job[];
  /** last terminal job — kept in the snapshot ~20s so a 2s-poll client ALWAYS
   * sees done/failed (03/11: a train that failed in <1s used to vanish between
   * polls → the click looked dead: no toast, no error, nothing). */
  lastDone: Job | null;
}

interface JobsGlobal {
  __elliottJobs?: { lanes: Map<JobKind, Lane>; seq: number };
}

const g = globalThis as JobsGlobal;
if (!g.__elliottJobs) g.__elliottJobs = { lanes: new Map(), seq: 0 };
const store = g.__elliottJobs;

const laneOf = (kind: JobKind): Lane => {
  let l = store.lanes.get(kind);
  if (!l) {
    l = { current: null, queue: [], lastDone: null };
    store.lanes.set(kind, l);
  }
  return l;
};

const reposition = (lane: Lane): void => {
  // position 0 = the running job (or the next one up when idle)
  for (const j of [lane.current, ...lane.queue]) {
    if (j) j.view.position = j === lane.current ? 0 : lane.queue.indexOf(j) + 1;
  }
};

function drain(lane: Lane): void {
  if (lane.current || lane.queue.length === 0) return;
  const job = lane.queue.shift()!;
  lane.current = job;
  reposition(lane);
  job.view.state = "running";
  job.view.startedAt = Date.now();
  const report = (patch: { progress?: JobProgress; extra?: Record<string, unknown> }): void => {
    if (patch.progress) job.view.progress = patch.progress;
    if (patch.extra) job.view.extra = { ...job.view.extra, ...patch.extra };
  };
  job
    .fn(report)
    .then((result) => {
      job.view.state = "done";
      job.view.position = 0;
      job.view.extra = { ...job.view.extra, ...result };
      job.view.finishedAt = Date.now();
      job.resolve(result);
      for (const j of job.joined) j(result);
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      job.view.state = "failed";
      job.view.error = msg;
      job.view.finishedAt = Date.now();
      job.reject(new Error(msg));
      for (const j of job.joined) j(job.view.extra); // joined callers still get partial data
    })
    .finally(() => {
      // the finished job leaves the lane but lingers as lastDone for ~20s —
      // its terminal state stays visible to every polling client
      lane.lastDone = job;
      lane.current = null;
      drain(lane);
    });
}

/**
 * Enqueue a job on its kind's lane. `label` identifies the work signature —
 * an identical QUEUED job (same kind+label) coalesces: both callers await the
 * same execution. A RUNNING job of the same kind makes newcomers WAIT (FIFO).
 */
export function enqueueJob(
  kind: JobKind,
  label: string,
  fn: Job["fn"],
): { promise: Promise<Record<string, unknown>>; view: JobView; coalesced: boolean } {
  const lane = laneOf(kind);
  // coalesce identical jobs that are still WAITING (never one that is running —
  // the user might legitimately want a fresh pass right after)
  const waiting = lane.queue.find((j) => j.label === label);
  if (waiting) {
    return {
      promise: new Promise<Record<string, unknown>>((resolve) => waiting.joined.push(resolve)),
      view: waiting.view,
      coalesced: true,
    };
  }
  store.seq += 1;
  const job: Job = {
    id: `${kind}-${store.seq}`,
    kind,
    label,
    fn,
    view: {
      id: `${kind}-${store.seq}`,
      kind,
      label,
      state: "queued",
      position: 0,
      progress: null,
      extra: {},
      startedAt: null,
      finishedAt: null,
    },
    resolve: () => undefined,
    reject: () => undefined,
    joined: [],
  };
  job.view.position = lane.queue.length + (lane.current ? 1 : 0);
  const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
    job.resolve = resolve;
    job.reject = reject;
  });
  lane.queue.push(job);
  reposition(lane);
  drain(lane);
  return { promise, view: job.view, coalesced: false };
}

/** Snapshot for GET /api/engine — running + queued first, then the last
 * finished job of each lane (max ~20s old) so nobody misses a fast failure. */
export function jobViews(): JobView[] {
  const out: JobView[] = [];
  const now = Date.now();
  for (const [, lane] of store.lanes) {
    for (const j of [lane.current, ...lane.queue]) {
      if (j) out.push({ ...j.view, progress: j.view.progress ? { ...j.view.progress } : null, extra: { ...j.view.extra } });
    }
    const ld = lane.lastDone;
    if (ld && ld !== lane.current && !lane.queue.includes(ld) && ld.view.finishedAt != null && now - ld.view.finishedAt < 20_000) {
      out.push({ ...ld.view, progress: ld.view.progress ? { ...ld.view.progress } : null, extra: { ...ld.view.extra } });
    }
  }
  return out;
}

/** Is any job of this kind queued or running (used to gate re-entry)? */
export function jobBusy(kind: JobKind): boolean {
  const lane = laneOf(kind);
  return lane.current != null || lane.queue.length > 0;
}
