// ─── Session-open Telegram broadcast — server-side, zero UI ──────────────────
// "Mỗi đầu phiên" — at every global session open (Sydney 21:00, Tokyo 00:00,
// London 07:00, New York 12:00 UTC) the scheduler started by
// instrumentation.ts fires one message into the .env Telegram channel,
// mirroring the "Phiên giao dịch" panel: Bull% / drift per session + the
// forecast lean, computed from BTCUSDT 1h closed candles fetched straight
// from Binance (same hosts the /api/klines relay rotates through).
//
// Why server-side: the client-side digests need a browser tab open; this
// timer lives in the standalone node process and fires 24/7 on the VPS.
// Dedupe state (session → last sent UTC date) lives in
// $DATA_DIR/session-bcast.json so restarts and repeated ticks never
// double-send. A boot that lands ≤10 minutes after an open still delivers;
// later than that the stale "đầu phiên" is skipped.
//
// Ops test switch: SESSION_BCAST_FORCE=1 in .env → one 🧪 preview message
// ~20 s after boot (does not touch dedupe state). Remove it afterwards.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dataFile, DATA_DIR } from "./data-dir";
import {
  SESSIONS,
  nextSessionOpen,
  sessionOf,
  sessionStats,
  type SessionKey,
  type SessionStat,
} from "./market";
import type { Kline } from "./types";
import { effectiveChatId, effectiveToken, tgSendMessage } from "./telegram-store";

const BCAST_SYMBOL = "BTCUSDT";
const BCAST_INTERVAL = "1h";
const KLINE_COUNT = 500; // ≈ 20 days of 1h history — same window the panel loads
/** ticks within this many minutes after the open hour still count as "đầu phiên" */
const LATE_WINDOW_MIN = 10;

const HOSTS = ["https://api.binance.com", "https://data-api.binance.vision", "https://api1.binance.com"];

const EMOJI: Record<SessionKey, string> = { sydney: "🔵", tokyo: "🟣", london: "🟡", newyork: "🟢" };
const NAME: Record<SessionKey, string> = { sydney: "Sydney", tokyo: "Tokyo", london: "London", newyork: "New York" };

const HR = "━━━━━━━━━━━━━━━━━━━━";
const pad2 = (n: number): string => String(n).padStart(2, "0");

// ─── Binance klines (server-side, host-fallback) ──────────────────────────────

async function fetchKlinesDirect(): Promise<Kline[]> {
  let lastErr: unknown = null;
  for (const host of HOSTS) {
    try {
      const url = `${host}/api/v3/klines?symbol=${BCAST_SYMBOL}&interval=${BCAST_INTERVAL}&limit=${KLINE_COUNT}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      const raw = (await res.json()) as unknown[];
      return raw.map((r) => {
        const row = r as [number, string, string, string, string, string, number, string, number, string];
        return {
          t: row[0],
          o: Number(row[1]),
          h: Number(row[2]),
          l: Number(row[3]),
          c: Number(row[4]),
          v: Number(row[5]),
          tb: Number(row[9]) || 0,
        };
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("kline fetch failed");
}

// ─── Message builder — mirrors the "Phiên giao dịch" panel ────────────────────

const driftTxt = (v: number | null | undefined): string =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(3)}%`;

/** "6h21p" / "45p" — same shape as the panel's forecast countdown. */
function inLabel(min: number): string {
  return min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}p` : ""}` : `${min}p`;
}

export function buildSessionOpenMessage(opened: SessionKey, now: number, klines: Kline[]): string {
  const stats = sessionStats(klines);
  const byKey = new Map(stats.map((s) => [s.key, s]));
  const openSet = new Set(sessionOf(now));
  const d = new Date(now);
  const openedDef = SESSIONS.find((s) => s.key === opened);
  const vnHour = openedDef ? (openedDef.from + 7) % 24 : d.getUTCHours(); // viewer TZ of the panel screenshots (GMT+7)

  const lines: string[] = [
    `🚦 <b>ĐẦU PHIÊN ${NAME[opened].toUpperCase()}</b> — ${pad2(vnHour)}:00 GMT+7 (${pad2(d.getUTCHours())}:00 UTC)`,
    HR,
  ];
  for (const s of SESSIONS) {
    const st = byKey.get(s.key);
    const bull = st?.bullPct != null ? `${st.bullPct.toFixed(0)}%` : "—";
    const isOpen = openSet.has(s.key);
    const state = s.key === opened ? "<b>VỪA MỞ 🚀</b>" : isOpen ? "đang mở" : "đóng";
    const mark = s.key === opened ? "🚀" : EMOJI[s.key];
    lines.push(`${mark} ${NAME[s.key]} — Bull ${bull} · drift ${driftTxt(st?.driftPct)} · ${state}`);
  }

  const nx = nextSessionOpen(now);
  const nxStat = nx ? byKey.get(nx.key) : undefined;
  if (nx && nxStat?.bullPct != null) {
    const dir = nxStat.bullPct >= 50 ? "LONG" : "SHORT";
    const p = Math.max(nxStat.bullPct, 100 - nxStat.bullPct).toFixed(0);
    lines.push(
      HR,
      `🔮 Phiên tới: <b>${NAME[nx.key]}</b> — mở sau ${inLabel(nx.inMin)} — thiên <b>${dir}</b> · P≈${p}% (${nxStat.candles} nến lịch sử)`,
    );
  }

  const valid = stats.filter((s): s is SessionStat & { bullPct: number } => s.bullPct != null && s.candles >= 5);
  if (valid.length >= 2) {
    const best = valid.reduce((a, b) => (b.bullPct > a.bullPct ? b : a));
    const worst = valid.reduce((a, b) => (b.bullPct < a.bullPct ? b : a));
    if (best.key !== worst.key) {
      lines.push(
        `📊 Lịch sử: ${NAME[best.key]} mạnh nhất (${best.bullPct.toFixed(0)}% nến tăng) · ${NAME[worst.key]} yếu nhất (${worst.bullPct.toFixed(0)}%)`,
      );
    }
  }
  lines.push(`💡 P = tỷ lệ nến đóng tăng của phiên (${BCAST_SYMBOL} ${BCAST_INTERVAL}) — thống kê lịch sử, không phải bảo đảm.`);
  return lines.join("\n");
}

// ─── Dedupe state + tick ──────────────────────────────────────────────────────

/** session key → last sent UTC date "YYYY-MM-DD" */
type BcastState = Partial<Record<SessionKey, string>>;
const STATE_FILE = "session-bcast.json";

function loadState(): BcastState {
  try {
    return JSON.parse(readFileSync(dataFile(STATE_FILE), "utf8")) as BcastState;
  } catch {
    return {};
  }
}

function saveState(st: BcastState): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(dataFile(STATE_FILE), JSON.stringify(st));
  } catch {
    // unwritable DATA_DIR → dedupe degrades to per-process (still no spam:
    // the global boot flag stops duplicate schedulers in the same process)
  }
}

export interface TickResult {
  due: SessionKey[];
  sent: SessionKey[];
  reason?: "telegram_not_configured" | "kline_fetch_failed";
}

/**
 * One scheduler pass. Fires at most one message per session per UTC date,
 * only within the first LATE_WINDOW_MIN minutes of the session's open hour.
 * Never throws — callers may fire-and-forget.
 */
export async function tickSessionBroadcast(now = Date.now()): Promise<TickResult> {
  if (!effectiveToken().token || !effectiveChatId().id) {
    return { due: [], sent: [], reason: "telegram_not_configured" };
  }
  const d = new Date(now);
  const dateKey = d.toISOString().slice(0, 10);
  const state = loadState();
  const due = SESSIONS.filter(
    (s) => s.from === d.getUTCHours() && d.getUTCMinutes() <= LATE_WINDOW_MIN && state[s.key] !== dateKey,
  ).map((s) => s.key);
  if (due.length === 0) return { due: [], sent: [] };

  let klines: Kline[];
  try {
    klines = await fetchKlinesDirect();
  } catch (e) {
    console.error(`[session-bcast] kline fetch failed: ${e instanceof Error ? e.message : e}`);
    return { due, sent: [], reason: "kline_fetch_failed" };
  }

  const sent: SessionKey[] = [];
  for (const key of due) {
    const r = await tgSendMessage(buildSessionOpenMessage(key, now, klines), "HTML");
    if (r.ok) {
      sent.push(key);
      const st = loadState(); // re-read: survives parallel ticks / manual edits
      st[key] = dateKey;
      saveState(st);
      console.log(`[session-bcast] ${key} open broadcast sent (${dateKey})`);
    } else {
      console.error(`[session-bcast] ${key} send failed: ${r.detail}`);
    }
  }
  return { due, sent };
}

/**
 * SESSION_BCAST_FORCE=1 → one 🧪 preview right after boot, built from live
 * data at whatever time the server started. Never touches dedupe state.
 */
export async function sendSessionPreview(): Promise<{ ok: boolean; detail?: string }> {
  if (!effectiveToken().token || !effectiveChatId().id) {
    return { ok: false, detail: "telegram_not_configured" };
  }
  const now = Date.now();
  const d = new Date(now);
  const openNow = sessionOf(now);
  const opened =
    SESSIONS.map((s) => s.key).find((k) => openNow.includes(k) && SESSIONS.find((s) => s.key === k)?.from === d.getUTCHours()) ??
    openNow[0] ??
    "london";
  try {
    const klines = await fetchKlinesDirect();
    const text = `🧪 <b>TEST — xem trước thông báo đầu phiên</b>\n\n${buildSessionOpenMessage(opened, now, klines)}`;
    return await tgSendMessage(text, "HTML");
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "kline fetch failed" };
  }
}

// ─── Scheduler (started once from instrumentation.register) ───────────────────

let started = false;

/** Idempotent — global flag survives dev-mode module reloads. */
export function startSessionBroadcastScheduler(): void {
  const g = globalThis as { __elliottSessionBcast?: boolean };
  if (started || g.__elliottSessionBcast) return;
  started = true;
  g.__elliottSessionBcast = true;

  const tick = (): void => {
    tickSessionBroadcast()
      .then((r) => {
        if (r.reason === "telegram_not_configured") return; // silent — .env not set yet
        if (r.sent.length > 0) console.log(`[session-bcast] tick sent: ${r.sent.join(", ")}`);
      })
      .catch((e) => console.error(`[session-bcast] tick error: ${e instanceof Error ? e.message : e}`));
  };

  // first pass shortly after boot — catches a start that lands inside a
  // session's LATE_WINDOW_MIN; then every minute (each pass is deduped)
  const boot = setTimeout(() => {
    tick();
    if (process.env.SESSION_BCAST_FORCE === "1") {
      void sendSessionPreview().then((r) =>
        console.log(`[session-bcast] force preview: ${r.ok ? "sent" : `failed — ${r.detail}`}`),
      );
    }
  }, 20_000);
  boot.unref?.();
  const iv = setInterval(tick, 60_000);
  iv.unref?.();
}
