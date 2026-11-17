// ─── Telegram dedupe — one choke point against multi-session spam ─────────────
// The auto-trade engine runs CLIENT-SIDE (one per open browser tab / device),
// but every notification funnel through tgSendMessage() on the server. That
// makes the server the perfect place to guarantee "N sessions → 1 message":
//
//   • tab A books the open and sends msgOpen  ─┐
//   • tab B (same setup, 2s later)        ────┤→ key `open:<tradeId>` seen
//   • device C (another browser)          ────┘   within TTL → suppressed
//
// Keys are SEMANTIC (caller-provided, stable across tabs/devices): the same
// event maps to the same key no matter who reports it. When no key is given
// the exact text hash is used — good enough for identical retries.
//
// State lives in DATA_DIR/tg-dedupe.json (survives restarts, shared by every
// server worker on the host) and is pruned on every write. Record-BEFORE-send
// + rollback-on-failure = at-most-once under races, retry-able on failure.

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { dataFile } from "@/lib/data-dir";

const FILE = dataFile("tg-dedupe.json");

/** suppress identical events for this long (env TG_DEDUPE_MS, 0 = off) */
export const DEFAULT_TTL_MS = 90_000;
const MAX_ENTRIES = 600;

export type DedupeMap = Record<string, number>; // key → last send epoch ms

export function dedupeTtlMs(): number {
  const raw = Number(process.env.TG_DEDUPE_MS);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_TTL_MS;
  return Math.floor(raw); // 0 → disabled
}

/** fallback key when the caller has no natural event id — exact text hash */
export function textKey(chatId: string | null, parseMode: string | undefined, text: string): string {
  return "h:" + createHash("sha256").update(`${chatId ?? ""}\u0000${parseMode ?? ""}\u0000${text}`).digest("hex").slice(0, 32);
}

/** true when this key has NOT been sent within the TTL window (→ may send) */
export function shouldSend(map: DedupeMap, key: string, now: number, ttlMs: number): boolean {
  const last = map[key];
  return !(typeof last === "number" && now - last < ttlMs);
}

/** record a send (pure — returns a new map) */
export function markSent(map: DedupeMap, key: string, now: number): DedupeMap {
  return { ...map, [key]: now };
}

/** undo a record (send failed → the next session may retry) — pure */
export function rollback(map: DedupeMap, key: string): DedupeMap {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

/** drop expired entries, then keep only the most recent MAX_ENTRIES */
export function prune(map: DedupeMap, now: number, ttlMs: number): DedupeMap {
  const fresh: DedupeMap = {};
  for (const [k, ts] of Object.entries(map)) {
    if (typeof ts === "number" && now - ts < ttlMs * 10) fresh[k] = ts; // keep some history for debugging
  }
  const keys = Object.keys(fresh);
  if (keys.length <= MAX_ENTRIES) return fresh;
  keys.sort((a, b) => fresh[b] - fresh[a]);
  for (const k of keys.slice(MAX_ENTRIES)) delete fresh[k];
  return fresh;
}

// ─── file-backed store (shared by all server code paths) ──────────────────────

export function loadDedupe(): DedupeMap {
  try {
    if (!existsSync(FILE)) return {};
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as DedupeMap;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function saveDedupe(map: DedupeMap): void {
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(map, null, 2) + "\n", "utf8");
  } catch {
    // best-effort — worst case a duplicate slips through after a failed write
  }
}

export interface DedupeResult {
  ok: boolean;
  /** true when the message was suppressed as a duplicate (treated as success) */
  deduped?: boolean;
  detail?: string;
}

/**
 * Gate one send through the dedupe store. `key` — caller's semantic event id
 * (open:<tradeId>, top:<5min-bucket>, …); null → exact-text hash. The record is
 * written BEFORE the send and rolled back when the send fails, so N racing
 * sessions produce at most one Telegram message and a transient failure can
 * still be retried by the next session.
 */
export async function dedupeSend(
  key: string | null,
  send: () => Promise<{ ok: boolean; detail?: string }>,
): Promise<DedupeResult> {
  const ttl = dedupeTtlMs();
  if (!key || ttl <= 0) return send(); // disabled / no key → pass-through
  const now = Date.now();
  let map = loadDedupe();
  if (!shouldSend(map, key, now, ttl)) return { ok: true, deduped: true };
  map = markSent(map, key, now);
  saveDedupe(prune(map, now, ttl));
  const r = await send();
  if (!r.ok) {
    saveDedupe(rollback(loadDedupe(), key));
    return r;
  }
  return { ok: true };
}
