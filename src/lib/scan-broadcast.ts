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
 *  28–29% kiểu ADA/XRP là nhiễu model yếu; dưới ngưỡng này KHÔNG gửi. */
export const BCAST_SCORE_MIN = 30;
const CANDIDATE_POOL = 8; // ranked rows inspected before giving up on filters

const HR_LINE = "─────────────────";
const HEAVY_LINE = "═══════════════";

export interface BcastState {
  /** message counter — "Lần #N" */
  n: number;
  /** `${symbol}-${interval}` keys already broadcast → ⚡NEW tagging */
  seen: Record<string, number>;
}

export const BCAST_LS_KEY = "utp.bcast";

// state file — same shape the browser localStorage used, now server-persisted
const STATE_FILE = dataFile("scan-bcast.json");

export function loadBcastState(): BcastState {
  try {
    const raw = readFileSync(STATE_FILE, "utf8");
    if (!raw) return { n: 0, seen: {} };
    const p = JSON.parse(raw) as Partial<BcastState>;
    return {
      n: typeof p.n === "number" && p.n >= 0 ? Math.floor(p.n) : 0,
      seen: p.seen && typeof p.seen === "object" ? p.seen : {},
    };
  } catch {
    return { n: 0, seen: {} };
  }
}

export function saveBcastState(st: BcastState): void {
  try {
    // keep the seen-map bounded — only the last 400 keys matter for ⚡NEW
    const entries = Object.entries(st.seen).sort((a, b) => b[1] - a[1]).slice(0, 400);
    mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ n: st.n, seen: Object.fromEntries(entries) }), "utf8");
  } catch {
    // unwritable DATA_DIR — counters live for this process only
  }
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
  emaTxt: string;
  rsiVal: number;
  rsiTxt: string;
  macdTxt: string;
  isNew: boolean;
}

const lastClosed = (k: Kline[]): Kline => k[Math.max(0, k.length - 2)];

function emaStackTxt(k: Kline[]): string {
  const e9 = ema(k, 9);
  const e21 = ema(k, 21);
  const e50 = ema(k, 50);
  const i = k.length - 2;
  const a = e9[i];
  const b = e21[i];
  const c = e50[i];
  if (a == null || b == null || c == null) return "EMA chưa đủ dữ liệu";
  // &lt;/&gt; entities — this text is embedded in HTML parse_mode messages
  // (raw "<21<50" made Telegram reject the whole message: "Unsupported start tag")
  if (a > b && b > c) return "📈 EMA9&gt;21&gt;50 (Uptrend mạnh)";
  if (a < b && b < c) return "📉 EMA9&lt;21&lt;50 (Downtrend mạnh)";
  if (a > b) return "📈 EMA9&gt;21 (Uptrend yếu)";
  if (a < b) return "📉 EMA9&lt;21 (Downtrend yếu)";
  return "➡️ EMA đi ngang";
}

function rsiZoneTxt(v: number): string {
  if (v <= 30) return `${v.toFixed(0)} (quá bán — rẻ)`;
  if (v < 45) return `${v.toFixed(0)} (vùng lý tưởng Buy)`;
  if (v <= 55) return `${v.toFixed(0)} (trung tính)`;
  if (v < 70) return `${v.toFixed(0)} (vùng lý tưởng Sell)`;
  return `${v.toFixed(0)} (quá mua — cẩn trọng)`;
}

function macdTxt(k: Kline[]): string {
  const { hist } = macd(k);
  const i = k.length - 2;
  const h = hist[i];
  const hp = hist[i - 1];
  if (h == null) return "MACD chưa đủ dữ liệu";
  const rising = hp != null && Math.abs(h) > Math.abs(hp);
  if (h > 0) return `MACD ↑ Momentum Buy ${rising ? "mạnh dần" : "yếu dần"}`;
  if (h < 0) return `MACD ↓ Momentum Sell ${rising ? "mạnh dần" : "yếu dần"}`;
  return "MACD trung tính";
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
      emaTxt: emaStackTxt(tfKlines),
      rsiVal,
      rsiTxt: rsiZoneTxt(rsiVal),
      macdTxt: macdTxt(tfKlines),
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
    `  • ${c.emaTxt}`,
    `  • RSI=${c.rsiTxt}`,
    `  • ${c.macdTxt}`,
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
  const seenSym = new Set<string>();
  const candidates: ScanRow[] = [];
  for (const r of rows) {
    if (r.auc < 0.55 || r.acc < 55) continue;
    if (r.score < BCAST_SCORE_MIN) continue;
    if (r.tpPct < BCAST_PL1_MIN) continue;
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
    if (c) picked.push(c);
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
    `📋 Vol ≥ $${(BCAST_VOL_MIN / 1e6).toFixed(0)}M │ PL1 ≥ ${BCAST_PL1_MIN}% │ Điểm ≥ ${BCAST_SCORE_MIN}`,
    `Dữ liệu: ${CANDIDATE_POOL} combo tốt nhất từ ${rows.length} combo quét`
  ];
  for (const c of picked) out.push(...coinBlock(c), "");
  out.push(HEAVY_LINE, `📊 Tổng: ${picked.length} coins đạt tiêu chí`, `⏱ Quét lại sau 5 phút`);
  return { text: out.join("\n"), picked: picked.map((c) => c.row) };
}
