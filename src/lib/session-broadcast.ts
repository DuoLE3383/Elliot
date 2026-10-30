// ─── Session-open Telegram broadcast — server-side, zero UI ──────────────────
// "Mỗi đầu phiên, gửi TRƯỚC 5 phút" — for every global session open
// (Sydney 21:00, Tokyo 00:00, London 07:00, New York 12:00 UTC) the scheduler
// started by instrumentation.ts fires one message into the .env Telegram
// channel 5 minutes BEFORE the open (window: open−5m … open+10m), mirroring
// the "Phiên giao dịch" panel: Bull% / drift per session + the forecast lean
// of the session about to open, computed from BTCUSDT 1h closed candles
// fetched straight from Binance (same hosts the /api/klines relay uses).
//
// Why server-side: the client-side digests need a browser tab open; this
// timer lives in the standalone node process and fires 24/7 on the VPS.
// Dedupe state (session → open UTC date) lives in $DATA_DIR/session-bcast.json
// so restarts and repeated ticks never double-send: the pre-open send also
// suppresses the post-open catch-up for the same open. A boot inside the
// window still delivers; later than that the stale open is skipped.
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
import { cycleForecast, type CycleStats, cycleStats } from "./cycles";
import { effectiveChatId, effectiveToken, tgSendMessage } from "./telegram-store";

const BCAST_SYMBOL = "BTCUSDT";
const BCAST_INTERVAL = "1h";
const KLINE_COUNT = 500; // ≈ 20 days of 1h history — same window the panel loads
/** daily candles for the calendar-cycle forecast (~2.7 years → ~140 samples per weekday) */
const DAILY_COUNT = 1000;
/** how many minutes BEFORE the open the announcement fires */
const EARLY_MIN = 5;
/** ticks within this many minutes AFTER the open still count (boot-late catch-up) */
const LATE_WINDOW_MIN = 10;

/** Binance USDT-M Futures — same board the chart reads, prices can differ from spot */
const HOSTS = ["https://fapi.binance.com", "https://fapi1.binance.com", "https://fapi2.binance.com"];

const EMOJI: Record<SessionKey, string> = { sydney: "🔵", tokyo: "🟣", london: "🟡", newyork: "🟢" };
const NAME: Record<SessionKey, string> = { sydney: "Sydney", tokyo: "Tokyo", london: "London", newyork: "New York" };

const HR = "━━━━━━━━━━━━━━━━━━━━";
const pad2 = (n: number): string => String(n).padStart(2, "0");

// ─── Binance klines (server-side, host-fallback) ──────────────────────────────

async function fetchKlinesDirect(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  let lastErr: unknown = null;
  for (const host of HOSTS) {
    try {
      const url = `${host}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
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

const DOW_VI = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

/** calendar-cycle lines for the broadcast — omitted (fail-open) without daily data */
function cycleLines(openTs: number, daily: Kline[] | null | undefined): string[] {
  if (!daily || daily.length < 60) return [];
  const stats = cycleStats(daily);
  if (!stats) return [];
  const fc = cycleForecast(openTs, stats);
  const dir = fc.dirUp ? "TĂNG" : "GIẢM";
  const p = Math.max(fc.dow.upPct ?? 50, 100 - (fc.dow.upPct ?? 50)).toFixed(0);
  const volUp =
    fc.volUp == null ? null : fc.volUp ? (fc.dow.volUpPct ?? 50) : 100 - (fc.dow.volUpPct ?? 50);
  const volTxt = volUp == null ? "trung tính" : `${fc.volUp ? "tăng" : "giảm"} ${volUp.toFixed(0)}%`;
  const lines = [
    `📅 Chu kỳ lịch: <b>${DOW_VI[fc.dowIndex]}</b> (${fc.dow.n} ngày) — chiều <b>${dir}</b> ${p}% · volume ${volTxt}`,
  ];
  const spUp = fc.special?.bucket.upPct;
  if (spUp != null) {
    const sp = fc.special!.bucket;
    const label =
      fc.special!.label === "quarterEnd" ? "Cuối quý" : fc.special!.label === "monthEnd" ? "Cuối tháng" : "Đầu tháng";
    const spDir = spUp >= 50 ? "tăng" : "giảm";
    const spP = Math.max(spUp, 100 - spUp).toFixed(0);
    const spVol =
      sp.volUpPct == null
        ? "—"
        : `${sp.volUpPct >= 50 ? "tăng" : "giảm"} ${Math.max(sp.volUpPct, 100 - sp.volUpPct).toFixed(0)}%`;
    lines.push(`📅 ${label} (n=${sp.n}) — chiều ${spDir} ${spP}% · volume ${spVol}`);
  }
  return lines;
}

export function buildSessionOpenMessage(
  opened: SessionKey,
  now: number,
  klines: Kline[],
  openTs = now,
  daily?: Kline[] | null,
): string {
  const stats = sessionStats(klines);
  const byKey = new Map(stats.map((s) => [s.key, s]));
  const openSet = new Set(sessionOf(now));
  const d = new Date(now);
  const o = new Date(openTs);
  const openedDef = SESSIONS.find((s) => s.key === opened);
  const vnHour = openedDef ? (openedDef.from + 7) % 24 : o.getUTCHours(); // viewer TZ of the panel screenshots (GMT+7)
  const pre = now < openTs; // announced before the session actually opens
  const inMin = Math.max(0, Math.round((openTs - now) / 60_000));

  const lines: string[] = [
    pre
      ? `⏳ <b>SẮP MỞ PHIÊN ${NAME[opened].toUpperCase()}</b> — sau ${inLabel(inMin)} — ${pad2(vnHour)}:00 GMT+7 (${pad2(o.getUTCHours())}:00 UTC)`
      : `🚦 <b>PHIÊN ${NAME[opened].toUpperCase()}</b> — ${pad2(vnHour)}:00 GMT+7 (${pad2(o.getUTCHours())}:00 UTC)`,
    HR,
  ];
  for (const s of SESSIONS) {
    const st = byKey.get(s.key);
    const bull = st?.bullPct != null ? `${st.bullPct.toFixed(0)}%` : "—";
    const isOpen = openSet.has(s.key);
    let state: string;
    let mark: string;
    if (s.key === opened) {
      state = pre ? `<b>sắp mở sau ${inLabel(inMin)} ⏳</b>` : "<b>VỪA MỞ 🚀</b>";
      mark = pre ? "⏳" : "🚀";
    } else {
      state = isOpen ? "đang mở" : "đóng";
      mark = EMOJI[s.key];
    }
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

  // calendar-cycle forecast for the OPEN day — weekday / month / quarter
  // frequencies from ~2.7 years of daily candles (omitted when daily fetch failed)
  lines.push(...cycleLines(openTs, daily));

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
 * One scheduler pass. Fires at most one message per session per open UTC date,
 * inside the window [open − EARLY_MIN, open + LATE_WINDOW_MIN] — normally the
 * pre-open announcement (−5 min); a boot later in the window sends the
 * "VỪA MỞ" catch-up instead. Never throws — callers may fire-and-forget.
 */
export async function tickSessionBroadcast(now = Date.now()): Promise<TickResult> {
  if (!effectiveToken().token || !effectiveChatId().id) {
    return { due: [], sent: [], reason: "telegram_not_configured" };
  }
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const state = loadState();
  interface Due {
    key: SessionKey;
    openTs: number;
    dateKey: string;
  }
  const due: Due[] = [];
  for (const s of SESSIONS) {
    // today's open — or tomorrow's for the pre-midnight window (Tokyo 00:00 → fires 23:55)
    for (const add of [0, 86_400_000]) {
      const openTs = midnight + s.from * 3_600_000 + add;
      if (now < openTs - EARLY_MIN * 60_000 || now > openTs + LATE_WINDOW_MIN * 60_000) continue;
      const dateKey = new Date(openTs).toISOString().slice(0, 10); // the OPEN date, not the fire date
      if (state[s.key] !== dateKey) due.push({ key: s.key, openTs, dateKey });
      break;
    }
  }
  if (due.length === 0) return { due: [], sent: [] };

  let klines: Kline[];
  try {
    klines = await fetchKlinesDirect(BCAST_SYMBOL, BCAST_INTERVAL, KLINE_COUNT);
  } catch (e) {
    console.error(`[session-bcast] kline fetch failed: ${e instanceof Error ? e.message : e}`);
    return { due: due.map((x) => x.key), sent: [], reason: "kline_fetch_failed" };
  }
  // daily history for the calendar-cycle forecast — a failed fetch just omits
  // the 📅 lines (fail-open); the session stats above remain mandatory
  let daily: Kline[] | null = null;
  try {
    daily = await fetchKlinesDirect(BCAST_SYMBOL, "1d", DAILY_COUNT);
  } catch {
    // fail-open
  }

  const sent: SessionKey[] = [];
  for (const item of due) {
    const r = await tgSendMessage(buildSessionOpenMessage(item.key, now, klines, item.openTs, daily), "HTML");
    if (r.ok) {
      sent.push(item.key);
      const st = loadState(); // re-read: survives parallel ticks / manual edits
      st[item.key] = item.dateKey;
      saveState(st);
      console.log(`[session-bcast] ${item.key} open broadcast sent (open ${item.dateKey})`);
    } else {
      console.error(`[session-bcast] ${item.key} send failed: ${r.detail}`);
    }
  }
  return { due: due.map((x) => x.key), sent };
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
    const klines = await fetchKlinesDirect(BCAST_SYMBOL, BCAST_INTERVAL, KLINE_COUNT);
    let daily: Kline[] | null = null;
    try {
      daily = await fetchKlinesDirect(BCAST_SYMBOL, "1d", DAILY_COUNT);
    } catch {
      // fail-open — preview still sends, just without the 📅 cycle lines
    }
    const text = `🧪 <b> — thông báo phiên</b>\n\n${buildSessionOpenMessage(opened, now, klines, now, daily)}`;
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

  // one visible line per boot — its ABSENCE in server logs means this module
  // never loaded (stale build / bundling issue) and the broadcast cannot fire
  const configured = Boolean(effectiveToken().token && effectiveChatId().id);
  console.log(
    `[session-bcast] scheduler armed — checking every 60s (Telegram configured: ${configured ? "yes" : "no"})`,
  );

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
