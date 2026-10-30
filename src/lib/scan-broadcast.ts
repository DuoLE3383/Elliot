// ─── Scan broadcast — "TOP coin tiềm năng" Telegram template ─────────────────
// Rebuilds the scan message in the user's favourite signal-bot format:
//
//   🏆 PEPE ENA — TOP 2 COIN TIỀM NĂNG NHẤT
//   ⏰ 20h34 29/10/2026 │ Lần #6689
//   📋 Vol≥$7M │ PL1≥5%
//
//   ✅ PEPE/USDT 1h │ Điểm: 60.8 (61%) │ BUY ⚡NEW
//   ────────────────────────────
//   💰 Giá hiện tại : …
//   … (Hỗ trợ/KH, Volume 24h, R:R, ATR %, PL1 %, Áp lực mua)
//   📡 Tín hiệu kỹ thuật: (EMA stack, RSI zone, MACD momentum, áp lực)
//   💡 Gợi ý giao dịch: (Entry range, SL, TP1, TP2)
//
//   ═════════════════════════════════
//   📊 Tổng: 2 coins đạt tiêu chí
//   ⏱ Quét lại sau 5 phút
//
// The message is ALWAYS Vietnamese (it mirrors the user's reference template).
// Data sources: the ranked scan rows (per symbol×TF) + a fresh 1h kline fetch
// per candidate for 24h volume / taker-buy pressure + the winning-interval
// klines for EMA/RSI/MACD/S&R. Filters: 24h quote volume ≥ $7M, PL1 (TP1 %)
// ≥ 5, one best combo per symbol, at most TOP_N coins per message.
//
// SERVER-SIDE since the backend-engine refactor: the broadcast runs in the
// Node scheduler (src/lib/engine.ts), klines come straight from Binance via
// klines-direct (no HTTP self-call), the counter/seen state lives in
// $DATA_DIR/scan-bcast.json (localStorage is a browser thing), and the clock
// is Asia/Ho_Chi_Minh — the channel's timezone.

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { dataFile } from "./data-dir";
import { atr, ema, macd, rsi } from "./indicators";
import { fetchKlinesDirect } from "./klines-direct";
import { fmtPrice, symbolLabel } from "./i18n";
import type { ScanRow } from "./autotrade";
import type { Kline, Ticker } from "./types";

export const BCAST_VOL_MIN = 7e6; // $7M 24h quote volume
export const BCAST_PL1_MIN = 5; // TP1 ≥ +5% from entry
export const BCAST_TOP_N = 2; // coins per message
/** Điểm tối thiểu để đăng broadcast — scoreOf = (AUC−0.5)×100 + (ACC−50) + tin cậy×15.
 *  30–40% kiểu PEPE/NEAR (img 03: 30.30 / 39.90) là model yếu — "điểm thấp quá đừng
 *  gợi ý": dưới 40 KHÔNG gửi, im lặng hơn là spam rác. */
export const BCAST_SCORE_MIN = 40;
/** Sàn AUC của model — 0.55 nghĩa là chỉ hơn tung đồng xu 5%: không đủ tin. */
export const BCAST_AUC_MIN = 0.58;
/** Sàn ACC của model — dưới 58% là overfit nhiễu. */
export const BCAST_ACC_MIN = 58;
/** Chống lặp: 1 coin (mọi khung giờ) chỉ được broadcast lại sau mỗi 3 giờ.
 *  RUNE 30m xuất hiện 4 lần trong 15 phút (4:11/4:15/4:21/4:25) vì `seen` cũ
 *  chỉ dùng để tag ⚡NEW chứ không chặn re-pick — đây là bản vá. */
export const BCAST_REPEAT_MS = 3 * 60 * 60_000;
/** Chống tín hiệu tự mâu thuẫn: EMA stack mạnh ngược hướng lệnh (kéo dao rơi /
 *  đuổi trần) và áp lực mua bán lệch hẳn phía bên kia đều bị loại. */
export const PRESSURE_FLOOR_LONG = 42; // BUY bị chặn khi áp lực mua ≤ 42%
export const PRESSURE_CAP_SHORT = 58; // SELL bị chặn khi áp lực mua ≥ 58%
const CANDIDATE_POOL = 8; // ranked rows inspected before giving up on filters

const HR_LINE = "─────────────────";
const HEAVY_LINE = "═══════════════";

export interface BcastState {
  /** message counter — "Lần #N" */
  n: number;
  /** `${symbol}-${interval}` keys already broadcast → ⚡NEW tagging */
  seen: Record<string, number>;
  /** symbol → epoch-ms of its last broadcast, ANY interval — re-broadcast cooldown */
  lastB: Record<string, number>;
}

export const BCAST_LS_KEY = "utp.bcast";

// state file — same shape the browser localStorage used, now server-persisted
const STATE_FILE = dataFile("scan-bcast.json");

export function loadBcastState(): BcastState {
  try {
    const raw = readFileSync(STATE_FILE, "utf8");
    if (!raw) return { n: 0, seen: {}, lastB: {} };
    const p = JSON.parse(raw) as Partial<BcastState>;
    return {
      n: typeof p.n === "number" && p.n >= 0 ? Math.floor(p.n) : 0,
      seen: p.seen && typeof p.seen === "object" ? p.seen : {},
      lastB: p.lastB && typeof p.lastB === "object" ? p.lastB : {},
    };
  } catch {
    return { n: 0, seen: {}, lastB: {} };
  }
}

export function saveBcastState(st: BcastState): void {
  try {
    // keep both maps bounded — only the last 400 keys matter
    const seen = Object.entries(st.seen).sort((a, b) => b[1] - a[1]).slice(0, 400);
    const lastB = Object.entries(st.lastB).sort((a, b) => b[1] - a[1]).slice(0, 400);
    mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    writeFileSync(
      STATE_FILE,
      JSON.stringify({ n: st.n, seen: Object.fromEntries(seen), lastB: Object.fromEntries(lastB) }),
      "utf8",
    );
  } catch {
    // unwritable DATA_DIR — counters live for this process only
  }
}

/** Ms left before a symbol may be re-broadcast (0 = allowed now). */
export function bcastRepeatLeftMs(lastMs: number | undefined, now = Date.now()): number {
  if (!lastMs || lastMs <= 0) return 0;
  return Math.max(0, lastMs + BCAST_REPEAT_MS - now);
}

interface CoinTech {
  row: ScanRow;
  price: number;
  support: number;
  resistance: number;
  vol24h: number; // quote-USDT
  volRatio: number; // vs the 10-day mean 24h volume
  buyPressure: number; // 0..100 taker-buy share of the last 24h
  atrPct: number; // ATR14 / price × 100 on the winning interval
  ema: EmaRead;
  rsiVal: number;
  rsiTxt: string;
  macd: MacdRead;
  isNew: boolean;
}

const lastClosed = (k: Kline[]): Kline => k[Math.max(0, k.length - 2)];

export interface EmaRead {
  txt: string;
  /** direction of the stack: "up" | "down" | "flat" */
  kind: "up" | "down" | "flat";
  /** true only for the full 9>21>50 (or <) stack — a strong, established trend */
  strong: boolean;
}

function emaStackRead(k: Kline[]): EmaRead {
  const e9 = ema(k, 9);
  const e21 = ema(k, 21);
  const e50 = ema(k, 50);
  const i = k.length - 2;
  const a = e9[i];
  const b = e21[i];
  const c = e50[i];
  if (a == null || b == null || c == null) return { txt: "EMA chưa đủ dữ liệu", kind: "flat", strong: false };
  // &lt;/&gt; entities — this text is embedded in HTML parse_mode messages
  // (raw "<21<50" made Telegram reject the whole message: "Unsupported start tag")
  if (a > b && b > c) return { txt: "📈 EMA9&gt;21&gt;50 (Uptrend mạnh)", kind: "up", strong: true };
  if (a < b && b < c) return { txt: "📉 EMA9&lt;21&lt;50 (Downtrend mạnh)", kind: "down", strong: true };
  if (a > b) return { txt: "📈 EMA9&gt;21 (Uptrend yếu)", kind: "up", strong: false };
  if (a < b) return { txt: "📉 EMA9&lt;21 (Downtrend yếu)", kind: "down", strong: false };
  return { txt: "➡️ EMA đi ngang", kind: "flat", strong: false };
}

export interface MacdRead {
  txt: string;
  /** histogram side: "buy" | "sell" | "flat" */
  dir: "buy" | "sell" | "flat";
  /** |hist| is growing — momentum is accelerating in `dir` */
  rising: boolean;
}

function macdRead(k: Kline[]): MacdRead {
  const { hist } = macd(k);
  const i = k.length - 2;
  const h = hist[i];
  const hp = hist[i - 1];
  if (h == null) return { txt: "MACD chưa đủ dữ liệu", dir: "flat", rising: false };
  const rising = hp != null && Math.abs(h) > Math.abs(hp);
  if (h > 0) return { txt: `MACD ↑ Momentum Buy ${rising ? "mạnh dần" : "yếu dần"}`, dir: "buy", rising };
  if (h < 0) return { txt: `MACD ↓ Momentum Sell ${rising ? "mạnh dần" : "yếu dần"}`, dir: "sell", rising };
  return { txt: "MACD trung tính", dir: "flat", rising: false };
}

export interface CoherenceInput {
  long: boolean;
  emaKind: "up" | "down" | "flat";
  emaStrong: boolean;
  macdDir: "buy" | "sell" | "flat";
  buyPressure: number;
}

/**
 * Bộ lọc tín hiệu tự mâu thuẫn — trả về lý do loại, hoặc null khi đạt.
 *
 * 1) "Kéo dao rơi": BUY khi EMA stack downtrend MẠNH (9<21<50), hay SELL khi
 *    uptrend MẠNH — lệnh đâm thẳng vào trend đã thiết lập. Model có thể tìm
 *    edge mean-reversion, nhưng broadcast cho người đọc thì message khoe
 *    "Downtrend mạnh" cạnh gợi ý BUY chỉ đáng mất niềm tin (PEPE 15m 4:11,
 *    PEPE 1h 4:21 — hai chiều ngược nhau trong 10 phút).
 * 2) Áp lực mua bán nghịch cực đoan: BUY khi taker-bản chiếm ≥58% (pressure
 *    ≤42%) hay SELL khi taker-mua chiếm ≥58% — phe kia đang áp đảo hoàn toàn.
 */
export function passesCoherence(i: CoherenceInput): string | null {
  if (i.long && i.emaKind === "down" && i.emaStrong) return "EMA downtrend mạnh mà gợi BUY (kéo dao rơi)";
  if (!i.long && i.emaKind === "up" && i.emaStrong) return "EMA uptrend mạnh mà gợi SELL (đuổi trần)";
  if (i.long && i.buyPressure <= PRESSURE_FLOOR_LONG)
    return `áp lực mua chỉ ${i.buyPressure.toFixed(1)}% mà gợi BUY`;
  if (!i.long && i.buyPressure >= PRESSURE_CAP_SHORT)
    return `áp lực mua tới ${i.buyPressure.toFixed(1)}% mà gợi SELL`;
  return null;
}

function rsiZoneTxt(v: number): string {
  if (v <= 30) return `${v.toFixed(0)} (quá bán — rẻ)`;
  if (v < 45) return `${v.toFixed(0)} (vùng lý tưởng Buy)`;
  if (v <= 55) return `${v.toFixed(0)} (trung tính)`;
  if (v < 70) return `${v.toFixed(0)} (vùng lý tưởng Sell)`;
  return `${v.toFixed(0)} (quá mua — cẩn trọng)`;
}

/** 24h quote volume, its ratio to the 10-day mean, and taker-buy pressure. */
function dayStats(hourly: Kline[]): { vol24h: number; volRatio: number; buyPressure: number } {
  const n = hourly.length;
  const quote = (k: Kline) => k.v * k.c;
  let vol24 = 0;
  for (let i = Math.max(0, n - 24); i < n; i++) vol24 += quote(hourly[i]);
  const win = Math.min(n, 240); // last 10 days of 1h candles
  let vol10d = 0;
  for (let i = Math.max(0, n - win); i < n; i++) vol10d += quote(hourly[i]);
  const days = win / 24;
  const mean = days > 0 ? vol10d / days : 0;
  let tb = 0;
  let tot = 0;
  for (let i = Math.max(0, n - 24); i < n; i++) {
    tb += hourly[i].tb ?? 0;
    tot += hourly[i].v;
  }
  return {
    vol24h: vol24,
    volRatio: mean > 0 ? vol24 / mean : 1,
    buyPressure: tot > 0 ? (tb / tot) * 100 : 50,
  };
}

function srLevels(k: Kline[]): { support: number; resistance: number } {
  const win = k.slice(Math.max(0, k.length - 96), k.length - 1); // last ~4 days, closed bars
  let support = Infinity;
  let resistance = 0;
  for (const b of win) {
    if (b.l < support) support = b.l;
    if (b.h > resistance) resistance = b.h;
  }
  if (!Number.isFinite(support)) support = k[k.length - 1].c;
  if (resistance <= 0) resistance = k[k.length - 1].c;
  return { support, resistance };
}

function pressureLine(p: number): string | null {
  if (p >= 70) return `💪 Áp lực mua mạnh ${p.toFixed(1)}%`;
  if (p >= 60) return `💪 Áp lực mua vừa ${p.toFixed(1)}%`;
  if (p <= 30) return `💪 Áp lực bán mạnh ${(100 - p).toFixed(1)}%`;
  if (p <= 40) return `💪 Áp lực bán vừa ${(100 - p).toFixed(1)}%`;
  return null; // neutral — the reference template omits it too
}

const sideWord = (bias: string): string => (bias === "SHORT" ? "Sell" : "Long");
const sideTag = (bias: string): string => (bias === "SHORT" ? "SELL 🔴" : "BUY 🟢");

async function enrich(row: ScanRow, tickers: Record<string, Ticker>, seen: Record<string, number>): Promise<CoinTech | null> {
  try {
    const [tfKlines, hourly] = await Promise.all([
      fetchKlinesDirect(row.symbol, row.interval),
      fetchKlinesDirect(row.symbol, "1h"),
    ]);
    if (tfKlines.length < 60 || hourly.length < 48) return null;
    const { vol24h, volRatio, buyPressure } = dayStats(hourly);
    if (vol24h < BCAST_VOL_MIN) return null;
    const tickerPrice = tickers[row.symbol]?.price ?? 0;
    const price = tickerPrice > 0 ? tickerPrice : lastClosed(tfKlines).c;
    const { support, resistance } = srLevels(tfKlines);
    const rsiArr = rsi(tfKlines, 14);
    const rsiVal = rsiArr[tfKlines.length - 2] ?? 50;
    const atrArr = atr(tfKlines, 14);
    const atrVal = atrArr[tfKlines.length - 2] ?? 0;
    return {
      row,
      price,
      support,
      resistance,
      vol24h,
      volRatio,
      buyPressure,
      atrPct: price > 0 ? (atrVal / price) * 100 : 0,
      ema: emaStackRead(tfKlines),
      rsiVal,
      rsiTxt: rsiZoneTxt(rsiVal),
      macd: macdRead(tfKlines),
      isNew: seen[`${row.symbol}-${row.interval}`] == null,
    };
  } catch {
    return null; // fetch failed → next candidate
  }
}

function coinBlock(c: CoinTech): string[] {
  const { row } = c;
  const long = row.bias !== "SHORT";
  const entryLo = long ? c.price : c.price * (1 - 0.003);
  const entryHi = long ? c.price * (1 + 0.003) : c.price;
  const slPrice = long ? c.price * (1 - row.slPct / 100) : c.price * (1 + row.slPct / 100);
  const tp1Price = long ? c.price * (1 + row.tpPct / 100) : c.price * (1 - row.tpPct / 100);
  // TP2 = the natural next level: the opposite S/R when it's beyond TP1…
  const srForSide = long ? c.resistance : c.support;
  const srBeyond = long ? srForSide > tp1Price : srForSide < tp1Price && srForSide > 0;
  // …otherwise project 2× the ATR-scaled TP distance
  const tp2Price = srBeyond ? srForSide : long ? c.price * (1 + (2 * row.tpPct) / 100) : c.price * (1 - (2 * row.tpPct) / 100);
  const tp2Label = srBeyond ? (long ? "resistance" : "support") : "mở rộng";
  const rr = row.slPct > 0 ? row.tpPct / row.slPct : 0;
  const lines = [
     HR_LINE,
    `${sideTag(row.bias)} <b>${row.symbol}</b> ${row.interval} │ Điểm: <b>${row.score.toFixed(2)}</b> (${Math.round(row.score)}%) │ ${c.isNew ? " ⚡ NEW" : ""}\n`,
    `💰 Giá hiện tại : <b>$${fmtPrice(c.price)}</b>`,
    `📈 Hỗ trợ/KH    : $${fmtPrice(c.support)} / $${fmtPrice(c.resistance)}`,
    `📊 Volume 24h   : $${(c.vol24h / 1e6).toFixed(0)}M (${c.volRatio.toFixed(2)}x TB)`,
    `⚖️ Risk:Reward  : 1:${rr.toFixed(2)}`,
    `🌊 ATR %        : ${c.atrPct.toFixed(2)}%`,
    `🎯 PL1 %        : ${row.tpPct.toFixed(2)}%`,
    `💪 Áp lực mua   : ${c.buyPressure.toFixed(2)}%`,
    "",
    `📡 <b>Tín hiệu kỹ thuật:</b>`,
    `  • ${c.ema.txt}`,
    `  • RSI=${c.rsiTxt}`,
    `  • ${c.macd.txt}`,
  ];
  const pLine = pressureLine(c.buyPressure);
  if (pLine) lines.push(`  • ${pLine}`);
  lines.push(
    "",
    `💡 <b>Gợi ý giao dịch:</b>`,
    `  🎯 Entry (${sideWord(row.bias)}): $${fmtPrice(entryLo)} - $${fmtPrice(entryHi)}`,
    `  🛡️ SL: $${fmtPrice(slPrice)} (${long ? "-" : "+"}${row.slPct.toFixed(1)}%)`,
    `  🏆 TP1: $${fmtPrice(tp1Price)} (${long ? "+" : "-"}${row.tpPct.toFixed(1)}%)`,
    `  🏆 TP2: $${fmtPrice(tp2Price)} (${tp2Label})`,
    `<i>Đây không phải lời khuyên đầu tư. Hãy tự chịu trách nhiệm với quyết định của mình.</i>`,
  );
  return lines;
}

/**
 * Build the whole broadcast message. Returns null when nothing passes the
 * filters (no message is sent rather than spamming an empty one).
 */
export async function buildTopCoinsMessage(
  rows: ScanRow[],
  tickers: Record<string, Ticker>,
  state: BcastState,
): Promise<{ text: string; picked: ScanRow[] } | null> {
  // best combo per symbol, ranked rows first, quality gates, PL1 floor, score floor
  const nowMs = Date.now();
  const seenSym = new Set<string>();
  const candidates: ScanRow[] = [];
  for (const r of rows) {
    if (r.auc < BCAST_AUC_MIN || r.acc < BCAST_ACC_MIN) continue;
    if (r.score < BCAST_SCORE_MIN) continue;
    if (r.tpPct < BCAST_PL1_MIN) continue;
    // re-broadcast cooldown — MỌI combo của một coin đã broadcast trong
    // BCAST_REPEAT_MS qua sẽ làm im cả coin (chống RUNE ×4 / 15 phút và
    // chống flip-flop PEPE 15m BUY → 1h SELL trong 10 phút)
    const left = bcastRepeatLeftMs(state.lastB[r.symbol], nowMs);
    if (left > 0) {
      if (!seenSym.has(r.symbol)) {
        seenSym.add(r.symbol);
        console.info(`[bcast] ${r.symbol} còn cooldown ${(left / 60_000).toFixed(0)}p — bỏ qua`);
      }
      continue;
    }
    if (seenSym.has(r.symbol)) continue;
    seenSym.add(r.symbol);
    candidates.push(r);
    if (candidates.length >= CANDIDATE_POOL) break;
  }

  const picked: CoinTech[] = [];
  for (const cand of candidates) {
    // cheap pre-filter on the live ticker before paying for kline fetches
    const qv = tickers[cand.symbol]?.quoteVolume;
    if (qv != null && qv > 0 && qv < BCAST_VOL_MIN) continue;
    const c = await enrich(cand, tickers, state.seen);
    if (c) {
      const contra = passesCoherence({
        long: cand.bias !== "SHORT",
        emaKind: c.ema.kind,
        emaStrong: c.ema.strong,
        macdDir: c.macd.dir,
        buyPressure: c.buyPressure,
      });
      if (contra) {
        console.info(`[bcast] ${cand.symbol} ${cand.interval} loại: ${contra}`);
        continue; // tín hiệu tự mâu thuẫn — thử combo kế tiếp
      }
      picked.push(c);
    }
    if (picked.length >= BCAST_TOP_N) break;
  }
  if (picked.length === 0) return null;

  // clock in the CHANNEL's timezone — the server runs UTC, the reader is VN
  const now = new Date();
  const vn = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const vnDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const [hm, dmy] = [vn.format(now), vnDate.format(now)]; // hm = "HH:MM", dmy = "dd/mm/yyyy"
  const hh = hm.slice(0, 2);
  const mm = hm.slice(3, 5);
  const [dd, mo, yyyy] = dmy.split("/");
  const dateStr = `${dd}/${mo}/${yyyy}`;
  const names = picked.map((c) => symbolLabel(c.row.symbol)).join(" ");

  const out: string[] = [
    `============================`,
    `🏆 <b>${names} </b> — TOP ${picked.length} COIN TIỀM NĂNG NHẤT`,
    `⏰ ${hh}h${mm} ${dateStr} │ Lần #${state.n + 1}`,
    `📋 Vol ≥ $${(BCAST_VOL_MIN / 1e6).toFixed(0)}M │ PL1 ≥ ${BCAST_PL1_MIN}% │ Điểm ≥ ${BCAST_SCORE_MIN} │ AUC ≥ ${BCAST_AUC_MIN} │ ACC ≥ ${BCAST_ACC_MIN}% │ Lặp ≥ ${Math.round(BCAST_REPEAT_MS / 3_600_000)}h`,
    `Dữ liệu: ${CANDIDATE_POOL} combo tốt nhất từ ${rows.length} combo quét`
  ];
  for (const c of picked) out.push(...coinBlock(c), "");
  out.push(HEAVY_LINE, `📊 Tổng: ${picked.length} coins đạt tiêu chí`, `⏱ Quét lại sau 5 phút`);
  return { text: out.join("\n"), picked: picked.map((c) => c.row) };
}
