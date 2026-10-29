// ─── Runtime data dir for server-side JSON state (server-only) ───────────────
// Runtime-mutable state that is NOT in SQLite (telegram.json, autostat.json)
// lives in one directory. Default `db/` keeps local/dev behaviour identical;
// on hosts with a dedicated persistent disk set DATA_DIR=/var/lib/elliott (or
// similar) in .env / systemd and EVERYTHING — DATABASE_URL included — points
// at that single directory, so rebuilds/redeploys can never wipe live data.

import path from "path";

/** absolute path of the runtime state directory (…/db unless DATA_DIR is set) */
export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "db");

/** absolute path of a JSON state file inside DATA_DIR */
export const dataFile = (name: string): string => path.join(DATA_DIR, name);
