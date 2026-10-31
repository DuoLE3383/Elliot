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
} from "./market";
import type { Kline } from "./types";
import { getSqueezeReport, squeezeLine, type SqueezeReport } from "./squeeze";
import { effectiveChatId, effectiveToken, tgSendMessage } from "./telegram-store";
import {
  SESS_BULL_LONG_MIN,
  SESS_BULL_SHORT_MAX,
  SESS_EARLY_MIN,
  SESS_INTERVAL,
  SESS_KLINE_COUNT,
  SESS_LATE_WINDOW_MIN,
  SESS_SYMBOL,
  SESS_TICK_MS,
} from "./params";

/** Binance USDT-M Futures — same board the chart reads, prices can differ from spot */
const HOSTS = ["https://fapi.binance.com", "https://fapi1.binance.com", "https://fapi2.binance.com"];

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

/**
 * Chiều hướng phiên tới từ bullPct lịch sử — 3 vùng 60/40: chỉ dám gọi
 * LONG/SHORT khi lệch rõ (≥60% / ≤40% nến tăng), giữa là SIDEWAYS. P hiển
 * thị luôn khớp chiều (LONG → %nến tăng, SHORT → %nến giảm) — hết kiểu
 * "SIDEWAYS mà P≈50%" dễ đọc nhầm là tín hiệu.
 */
export function sessionDirection(bullPct: number): { dir: "LONG" | "SHORT" | "SIDEWAYS"; pPct: number; pTxt: string } {
  const b = bullPct;
  if (b >= SESS_BULL_LONG_MIN) return { dir: "LONG", pPct: b, pTxt: `P≈${b.toFixed(1)}% nến tăng` };
  if (b <= SESS_BULL_SHORT_MAX) return { dir: "SHORT", pPct: 100 - b, pTxt: `P≈${(100 - b).toFixed(1)}% nến giảm` };
  return { dir: "SIDEWAYS", pPct: Math.max(b, 100 - b), pTxt: `${b.toFixed(1)}% nến tăng — không thiên hướng rõ` };
}

/**
 * LEAN message — chỉ thứ trader cần (bỏ bảng 4 phiên + thống kê chu kỳ lịch
 * vốn khiến tin dài và khó đọc):
 *   1. tên phiên + giờ mở (GMT+7/UTC) + đếm ngược nếu báo trước
 *   2. phiên mở: Bull % · drift BTC · trạng thái
 *   3. phiên kế tiếp: mở sau bao lâu + Chiều Hướng (LONG/SHORT/SIDEWAYS) + P + n
 *   4. ⛓ sức ép đòn bẩy (OI + long/short + taker + funding) — radar dump/squeeze
 *   5. chú thích nguồn dữ liệu
 */
export function buildSessionOpenMessage(
  opened: SessionKey,
  now: number,
  klines: Kline[],
  openTs = now,
  sq: SqueezeReport | null = null,
): string {
  const stats = sessionStats(klines);
  const byKey = new Map(stats.map((s) => [s.key, s]));
  const o = new Date(openTs);
  const openedDef = SESSIONS.find((s) => s.key === opened);
  const vnHour = openedDef ? (openedDef.from + 7) % 24 : o.getUTCHours(); // viewer TZ of the panel screenshots (GMT+7)
  const pre = now < openTs; // announced before the session actually opens
  const inMin = Math.max(0, Math.round((openTs - now) / 60_000));

  const st = byKey.get(opened);
  const lines: string[] = [
    pre
      ? `⏳ <b>SẮP MỞ PHIÊN ${NAME[opened].toUpperCase()}</b> — sau ${inLabel(inMin)} — ${pad2(vnHour)}:00 GMT+7 (${pad2(o.getUTCHours())}:00 UTC)`
      : `🚦 <b>PHIÊN ${NAME[opened].toUpperCase()}</b> — ${pad2(vnHour)}:00 GMT+7 (${pad2(o.getUTCHours())}:00 UTC)`,
    HR,
    `${pre ? "⏳" : "🚀"} <b>${NAME[opened]}</b> — Bull ${st?.bullPct != null ? `${st.bullPct.toFixed(0)}%` : "—"} · drift BTC ${driftTxt(st?.driftPct)} · ${
      pre ? `sắp mở sau ${inLabel(inMin)}` : "<b>VỪA MỞ 🚀</b>"
    }`,
  ];

  const nx = nextSessionOpen(now);
  if (nx) {
    const nxStat = byKey.get(nx.key);
    if (nxStat?.bullPct != null) {
      const d = sessionDirection(nxStat.bullPct);
      lines.push(
        `🔮 Phiên tới: <b>${NAME[nx.key]}</b> — mở sau ${inLabel(nx.inMin)} — Chiều Hướng <b>${d.dir}</b> · ${d.pTxt} (n=${nxStat.candles} phiên gần nhất)`,
      );
    } else {
      lines.push(`🔮 Phiên tới: <b>${NAME[nx.key]}</b> — mở sau ${inLabel(nx.inMin)}`);
    }
  }

  // ⛓ radar đòn bẩy — dữ liệu gốc Binance Futures (nguồn Coinglass tổng hợp):
  // OI + long/short + taker + funding → cảnh báo dump / short-squeeze TRƯỚC
  // khi giá chạy. Lỗi fetch → bỏ khối, không cản tin phiên.
  if (sq) lines.push(squeezeLine(sq));

  lines.push(
    `💡 Thống kê lịch sử (${SESS_SYMBOL} ${SESS_INTERVAL}) · ⛓ = OI + long/short + taker + funding từ Binance Futures — nguồn gốc mà Coinglass tổng hợp. Thống kê ≠ bảo đảm — luôn đặt SL.`,
  );
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
      if (now < openTs - SESS_EARLY_MIN * 60_000 || now > openTs + SESS_LATE_WINDOW_MIN * 60_000) continue;
      const dateKey = new Date(openTs).toISOString().slice(0, 10); // the OPEN date, not the fire date
      if (state[s.key] !== dateKey) due.push({ key: s.key, openTs, dateKey });
      break;
    }
  }
  if (due.length === 0) return { due: [], sent: [] };

  let klines: Kline[];
  try {
    klines = await fetchKlinesDirect(SESS_SYMBOL, SESS_INTERVAL, SESS_KLINE_COUNT);
  } catch (e) {
    console.error(`[session-bcast] kline fetch failed: ${e instanceof Error ? e.message : e}`);
    return { due: due.map((x) => x.key), sent: [], reason: "kline_fetch_failed" };
  }
  // radar đòn bẩy chạy song song kiến thức phiên — fail thì bỏ khối ⛓
  const sq = await getSqueezeReport(BCAST_SYMBOL).catch(() => null);

  const sent: SessionKey[] = [];
  for (const item of due) {
    const r = await tgSendMessage(buildSessionOpenMessage(item.key, now, klines, item.openTs, sq), "HTML");
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
    const [klines, sq] = await Promise.all([
      fetchKlinesDirect(SESS_SYMBOL, SESS_INTERVAL, SESS_KLINE_COUNT),
      getSqueezeReport(SESS_SYMBOL).catch(() => null),
    ]);
    const text = `🧪 <b> — thông báo phiên</b>\n\n${buildSessionOpenMessage(opened, now, klines, now, sq)}`;
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
  const iv = setInterval(tick, SESS_TICK_MS);
  iv.unref?.();
}
