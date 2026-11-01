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
import {
  BCAST_AUC_MIN,
  BCAST_ACC_MIN,
  BCAST_PL1_MIN,
  BCAST_REPEAT_MS,
  BCAST_SCORE_MIN,
  BCAST_TOP_N,
  BCAST_VOL_MIN,
  gateRow,
  passesCoherence,
  type QualSp,
} from "./bcast-gate";
import { SCAN_DIGEST_POOL, SCAN_DIGEST_TOP_N } from "./params";
import { getMarketPulse } from "./market-pulse";

// MỘT thuật toán gate sống ở ./bcast-gate — re-export để chỗ cũ (test, panel)
// vẫn import từ đây được mà không tạo bản sao thuật toán.
export {
  BCAST_VOL_MIN,
  BCAST_PL1_MIN,
  BCAST_TOP_N,
  BCAST_SCORE_MIN,
  BCAST_AUC_MIN,
  BCAST_ACC_MIN,
  BCAST_REPEAT_MS,
  PRESSURE_FLOOR_LONG,
  PRESSURE_CAP_SHORT,
  bcastRepeatLeftMs,
  gateRow,
  passesCoherence,
} from "./bcast-gate";
export type { CoherenceInput } from "./bcast-gate";

const CANDIDATE_POOL = 8; // ranked rows inspected before giving up on filters

const HR_LINE = "─────────────────";
const HEAVY_LINE = "═══════════════";
// (escHtml đã bỏ 0.2.45 — tin quét không còn nhúng lý do chặn từ dữ liệu động)

export interface BcastState {
  /** message counter — "Lần #N" */
  n: number;
  /** `${symbol}-${interval}` keys already broadcast → ⚡NEW tagging */
  seen: Record<string, number>;
  /** symbol → epoch-ms of its last broadcast, ANY interval — re-broadcast cooldown */
  lastB: Record<string, number>;
  /** epoch-ms của lần gửi tin "QUÉT LỆNH · TOP 10" gần nhất (0.2.35) */
  scan10?: number;
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
      scan10: typeof p.scan10 === "number" && p.scan10 >= 0 ? p.scan10 : 0,
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
      JSON.stringify({
        n: st.n,
        seen: Object.fromEntries(seen),
        lastB: Object.fromEntries(lastB),
        scan10: st.scan10 ?? 0,
      }),
      "utf8",
    );
  } catch {
    // unwritable DATA_DIR — counters live for this process only
  }
}

/** Ms left before a symbol may be re-broadcast (0 = allowed now). */
// (moved to bcast-gate.ts — re-exported above)

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

// passesCoherence — moved to bcast-gate.ts (re-exported above)

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

/** Phán quyết gate cho MỘT combo quét — upsert vào bảng BcastVerdict (custom.db)
 *  và hiện thẳng trên panel; Telegram chỉ đăng combo verdict "pass". */
export interface BcastVerdictRow {
  symbol: string;
  interval: string;
  side: string;
  score: number;
  auc: number;
  acc: number;
  verdict: "pass" | "reject";
  reason: string;
}

/**
 * Build the whole broadcast message. Returns `text: null` when nothing passes
 * the filters (no message is sent rather than spamming an empty one) — nhưng
 * `verdicts` LUÔN đầy đủ cho mọi combo đầu vào: đây là phán quyết của thuật
 * toán gate duy nhất (bcast-gate.gateRow) mà panel đọc lại qua DB.
 */
export async function buildTopCoinsMessage(
  rows: ScanRow[],
  tickers: Record<string, Ticker>,
  state: BcastState,
  uniSyms?: Set<string>,
  /** ngưỡng chất lượng chung từ cfg — không truyền → BCAST_* mặc định */
  sp?: QualSp,
): Promise<{ text: string | null; picked: ScanRow[]; verdicts: BcastVerdictRow[] }> {
  const spEff = sp ?? { score: BCAST_SCORE_MIN, auc: BCAST_AUC_MIN, acc: BCAST_ACC_MIN };
  const nowMs = Date.now();
  // ── MỘT lần chấm duy nhất bằng gateRow cho TẤT CẢ combo ──────────────────
  const verdicts: BcastVerdictRow[] = rows.map((r) => {
    const g = gateRow(r, {
      now: nowMs,
      lastB: state.lastB,
      uniSyms,
      tickerVol: tickers[r.symbol]?.quoteVolume,
      sp,
    });
    return {
      symbol: r.symbol,
      interval: r.interval,
      side: r.bias,
      score: r.score,
      auc: r.auc,
      acc: r.acc,
      verdict: g.pass ? "pass" : "reject",
      reason: g.reason,
    };
  });

  // best combo per symbol among the PASSERS (rows arrive ranked by score)
  const seenSym = new Set<string>();
  const candidates: ScanRow[] = [];
  for (let i = 0; i < rows.length && candidates.length < CANDIDATE_POOL; i++) {
    if (verdicts[i].verdict !== "pass") continue;
    if (seenSym.has(rows[i].symbol)) continue;
    seenSym.add(rows[i].symbol);
    candidates.push(rows[i]);
  }

  const picked: CoinTech[] = [];
  for (const cand of candidates) {
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
        // cập nhật phán quyết — coherence là một phần của CÙNG thuật toán
        const vd = verdicts.find((x) => x.symbol === cand.symbol && x.interval === cand.interval);
        if (vd) {
          vd.verdict = "reject";
          vd.reason = contra;
        }
        continue; // tín hiệu tự mâu thuẫn — thử combo kế tiếp
      }
      picked.push(c);
    }
    if (picked.length >= BCAST_TOP_N) break;
  }
  if (picked.length === 0) return { text: null, picked: [], verdicts };

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
    `📋 Vol ≥ $${(BCAST_VOL_MIN / 1e6).toFixed(0)}M │ PL1 ≥ ${BCAST_PL1_MIN}% │ Điểm ≥ ${spEff.score} │ AUC ≥ ${spEff.auc} │ ACC ≥ ${spEff.acc}% │ Lặp ≥ ${Math.round(BCAST_REPEAT_MS / 3_600_000)}h`,
    `Dữ liệu: ${CANDIDATE_POOL} combo tốt nhất từ ${rows.length} combo quét`
  ];
  for (const c of picked) out.push(...coinBlock(c), "");
  out.push(HEAVY_LINE, `📊 Tổng: ${picked.length} coins đạt tiêu chí`, `⏱ Quét lại sau 5 phút`);
  return { text: out.join("\n"), picked: picked.map((c) => c.row), verdicts: [] };
}

// ─── Scan digest — tin "QUÉT LỆNH" 8 giờ/lần (0.2.35, khoét gọn 0.2.45) ─────
// 0.2.35: tin tổng hợp 8h/lần — 10 combo tốt nhất theo điểm model KỂ CẢ chưa
// đạt cổng (kèm lý do chặn). 0.2.45 theo yêu cầu "điểm dưới điểm cài đặt thì
// khỏi post cho đỡ spam — post những thứ cần thiết thôi như thông tin thị
// trường, tình hình phiên": tin CHỈ liệt kê combo ĐẠT CỔNG (🚀 + SL/TP);
// 0 combo đạt → KHÔNG gửi gì cả (verdict vẫn ghi đủ bảng BcastVerdict cho
// panel web). Đáy tin thêm 1 dòng thông tin thị trường (F&G · BTC.D ·
// funding · long/short) từ market-pulse (0.2.43) — fail-soft, lỗi nguồn ngoài
// không cản tin quét.

/** Nhãn F&G tiếng Việt cho dòng thị trường đáy tin. */
const FG_VN: Record<string, string> = {
  "Extreme Fear": "Hoảng loạn",
  Fear: "Sợ hãi",
  Neutral: "Trung tính",
  Greed: "Tham lam",
  "Extreme Greed": "Tham lam cực độ",
};

/** 1 dòng "🌡 Thị trường: …" — F&G · BTC.D · funding · long/short. */
async function marketPulseLine(): Promise<string | null> {
  try {
    const mp = await getMarketPulse();
    const parts: string[] = [];
    if (mp.fearGreed) {
      parts.push(`F&G ${mp.fearGreed.now.value} (${FG_VN[mp.fearGreed.now.label] ?? mp.fearGreed.now.label})`);
    }
    if (mp.global?.btcDominance != null) parts.push(`BTC.D ${mp.global.btcDominance.toFixed(1)}%`);
    if (mp.derivatives?.fundingRatePct != null) {
      const f = mp.derivatives.fundingRatePct;
      parts.push(`Funding ${f >= 0 ? "+" : ""}${f.toFixed(3)}%`);
    }
    if (mp.derivatives?.longAccountPct != null) {
      const l = mp.derivatives.longAccountPct;
      parts.push(`L/S ${l.toFixed(0)}/${(100 - l).toFixed(0)}`);
    }
    if (parts.length === 0) return null;
    return `🌡 <b>Thị trường:</b> ${parts.join(" · ")}`;
  } catch {
    return null; // nguồn ngoài chết — tin quét vẫn gửi, chỉ thiếu dòng này
  }
}

export async function buildScanTop10Message(
  rows: ScanRow[],
  tickers: Record<string, Ticker>,
  state: BcastState,
  uniSyms?: Set<string>,
  sp?: QualSp,
): Promise<{ text: string | null; picked: ScanRow[]; verdicts: BcastVerdictRow[] }> {
  const spEff = sp ?? { score: BCAST_SCORE_MIN, auc: BCAST_AUC_MIN, acc: BCAST_ACC_MIN };
  const nowMs = Date.now();
  // MỘT lần chấm duy nhất bằng gateRow cho TẤT CẢ combo — cùng thuật toán
  const verdicts: BcastVerdictRow[] = rows.map((r) => {
    const g = gateRow(r, {
      now: nowMs,
      lastB: state.lastB,
      uniSyms,
      tickerVol: tickers[r.symbol]?.quoteVolume,
      sp,
    });
    return {
      symbol: r.symbol,
      interval: r.interval,
      side: r.bias,
      score: r.score,
      auc: r.auc,
      acc: r.acc,
      verdict: g.pass ? "pass" : "reject",
      reason: g.reason,
    };
  });

  // pool: CHỈ combo ĐẠT CỔNG (0.2.45 — combo bị chặn không vào tin nữa), mỗi
  // symbol một combo, điểm giảm dần, tối đa SCAN_DIGEST_POOL để làm giàu
  const seenSym = new Set<string>();
  const candidates: ScanRow[] = [];
  for (const r of [...rows].sort((a, b) => b.score - a.score)) {
    const vd = verdicts.find((x) => x.symbol === r.symbol && x.interval === r.interval);
    if (vd?.verdict !== "pass") continue;
    if (seenSym.has(r.symbol)) continue;
    seenSym.add(r.symbol);
    candidates.push(r);
    if (candidates.length >= SCAN_DIGEST_POOL) break;
  }

  const enriched: CoinTech[] = [];
  for (const cand of candidates) {
    const c = await enrich(cand, tickers, state.seen);
    if (!c) continue; // vol/fetch hỏng — bỏ khỏi tin (verdict giữ như buildTopCoinsMessage)
    const vd = verdicts.find((x) => x.symbol === cand.symbol && x.interval === cand.interval);
    const contra = passesCoherence({
      long: cand.bias !== "SHORT",
      emaKind: c.ema.kind,
      emaStrong: c.ema.strong,
      macdDir: c.macd.dir,
      buyPressure: c.buyPressure,
    });
    if (contra && vd) {
      vd.verdict = "reject";
      vd.reason = contra;
      continue; // tự mâu thuẫn → thành reject — không liệt kê
    }
    enriched.push(c);
    if (enriched.length >= SCAN_DIGEST_TOP_N) break;
  }
  // 0 combo đạt cổng sau enrich → KHÔNG gửi tin (đỡ spam — 0.2.45);
  // verdict đã đầy đủ ở trên, engine vẫn ghi DB cho panel trước khi check text.
  if (enriched.length === 0) return { text: null, picked: [], verdicts };

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
  const [hm, dmy] = [vn.format(now), vnDate.format(now)];
  const [dd, mo, yyyy] = dmy.split("/");
  const nPass = verdicts.filter((v) => v.verdict === "pass").length;

  const out: string[] = [
    `🔍 <b>QUÉT LỆNH · ${enriched.length} COIN ĐẠT CỔNG</b> (theo điểm model)`,
    `⏰ ${hm} ${dd}/${mo}/${yyyy} │ Lần #${state.n + 1} │ <b>${nPass}/${rows.length}</b> combo đạt cổng`,
    `📋 Sàn: Điểm ≥ ${spEff.score} │ AUC ≥ ${spEff.auc} │ ACC ≥ ${spEff.acc}% — chỉ liệt kê combo đạt cổng (lý do chặn xem panel web)`,
  ];
  enriched.forEach((c, i) => {
    const { row } = c;
    const long = row.bias !== "SHORT";
    const pTxt = long ? `${(row.prob * 100).toFixed(1)}% lên` : `${((1 - row.prob) * 100).toFixed(1)}% xuống`;
    const slPx = long ? c.price * (1 - row.slPct / 100) : c.price * (1 + row.slPct / 100);
    const tpPx = long ? c.price * (1 + row.tpPct / 100) : c.price * (1 - row.tpPct / 100);
    out.push(
      `${HR_LINE}`,
      `${i + 1}. ${sideTag(row.bias)} <b>${row.symbol}</b> ${row.interval} │ Điểm <b>${row.score.toFixed(1)}</b> · AUC ${row.auc.toFixed(2)} · ACC ${row.acc.toFixed(1)}% · Prob ${pTxt}`,
      `   💰 $${fmtPrice(c.price)} · 24h ${c.vol24h >= 1e6 ? `$${(c.vol24h / 1e6).toFixed(0)}M` : fmtPrice(c.vol24h)} · RSI ${c.rsiVal.toFixed(0)} · ATR ${c.atrPct.toFixed(2)}%${c.isNew ? " · ⚡NEW" : ""}`,
      `   🚀 <b>ĐẠT CỔNG</b> — SL $${fmtPrice(slPx)} (${row.slPct.toFixed(1)}%) · TP1 $${fmtPrice(tpPx)} (+${row.tpPct.toFixed(1)}%)`,
    );
  });
  out.push(HEAVY_LINE);
  const pulse = await marketPulseLine();
  if (pulse) out.push(pulse);
  out.push(
    `⏱ Tin tổng hợp 8 giờ/lần · chỉ gửi khi CÓ combo đạt cổng · engine quét + chấm cổng mỗi 5 phút (panel web)`,
    `<i>Đây không phải lời khuyên đầu tư. Hãy tự chịu trách nhiệm với quyết định của mình.</i>`,
  );
  return { text: out.join("\n"), picked: enriched.map((c) => c.row), verdicts };
}
