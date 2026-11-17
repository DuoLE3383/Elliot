// ─── Scan state persistence — the backend's last scan + universe snapshot ────
// The engine's scan/universe results used to live ONLY in module memory — a
// pm2 restart (every deploy) wiped them and every browser tab showed
// "No scan data yet — hit 'Scan all'" until the next 5-min bucket re-scanned,
// even though the backend had been scanning for hours. Both snapshots now
// persist to $DATA_DIR/scan-state.json and reload at boot, so the panel shows
// the last known ranking immediately (with its timestamp) and the scheduler
// keeps its own freshness rules (SCAN_FRESH_MS / SCAN_TTL) — stale data is
// DISPLAYED as stale, never traded as fresh.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { dataFile } from "./data-dir";
import type { ScanRow } from "./autotrade";
import type { UniverseRow } from "./universe";

export interface TimedRows<R> {
  rows: R[];
  at: number;
}

export interface ScanState {
  scan: TimedRows<ScanRow> | null;
  universe: TimedRows<UniverseRow> | null;
}

const FILE = dataFile("scan-state.json");
const MAX_ROWS = 500;

function valid<R>(v: unknown, guard: (x: unknown) => boolean): TimedRows<R> | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { rows?: unknown; at?: unknown };
  if (!Array.isArray(o.rows) || typeof o.at !== "number" || !Number.isFinite(o.at) || o.at <= 0) return null;
  const rows = o.rows.filter(guard).slice(0, MAX_ROWS);
  return rows.length > 0 ? { rows: rows as R[], at: o.at } : null;
}

const isScanRow = (x: unknown): boolean =>
  typeof x === "object" &&
  x != null &&
  typeof (x as ScanRow).symbol === "string" &&
  typeof (x as ScanRow).interval === "string" &&
  typeof (x as ScanRow).auc === "number" &&
  typeof (x as ScanRow).score === "number";

const isUniverseRow = (x: unknown): boolean =>
  typeof x === "object" &&
  x != null &&
  typeof (x as UniverseRow).symbol === "string" &&
  typeof (x as UniverseRow).score === "number" &&
  typeof (x as UniverseRow).atrPct === "number";

export function loadScanState(): ScanState {
  try {
    if (!existsSync(FILE)) return { scan: null, universe: null };
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Partial<ScanState>;
    return {
      scan: valid<ScanRow>(raw.scan, isScanRow),
      universe: valid<UniverseRow>(raw.universe, isUniverseRow),
    };
  } catch {
    return { scan: null, universe: null };
  }
}

/** Merge-patch one snapshot (scan or universe) into the state file. */
export function saveScanState(patch: {
  scan?: TimedRows<ScanRow> | null;
  universe?: TimedRows<UniverseRow> | null;
}): void {
  try {
    const cur = loadScanState();
    const next: ScanState = {
      scan: patch.scan !== undefined ? patch.scan : cur.scan,
      universe: patch.universe !== undefined ? patch.universe : cur.universe,
    };
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(next), "utf8");
  } catch {
    // unwritable DATA_DIR — snapshots live for this process only
  }
}
