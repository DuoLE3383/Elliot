// ─── WYCKOFF ENGINE — SỔ C: PHỄU GỐC 5 LỚP (0.2.97) ──────────────────────────
// Port 1-1 các hàm gốc của YoungCan-Wang/WyckoffTradingAgent (core/
// wyckoff_engine.py, 3011 dòng) lên crypto USDT-M perp, giữ ĐẦY ĐỦ thông số
// production của repo gốc (FunnelConfig defaults):
//
//   L1 thanh khoản  — gốc: market cap ≥ 25亿 + avg amount ≥ 4000万 CNY
//                     → crypto: quote volume TB ngày ×20 ≥ WYC_L1_QUOTE_VOL
//   L2 sức mạnh     — markup: MA50 > MA200 giữ ≥ 5 ngày + góc MA50 ≥ 2%/5d +
//                     bias200 ≤ 25% + RPS50 ≥ 65 / RPS120 ≥ 70 (bypass 80→50)
//                     (RPS = percentile rank ret20/ret60 trong universe)
//   L3 cộng hưởng   — gốc: top-5 ngành hot → crypto KHÔNG có ngành: dùng breadth
//                     regime RISK_ON (% universe trên MA20 ≥ 50) — cùng ngưỡng
//                     đã verify 07/11 (RISK_ON là điều kiện sống còn của SOS)
//   L4 trigger      — Spring / SOS / EVR / TrendPullback đúng công thức gốc
//                     (LPS + Compression gốc để OFF → giữ nguyên OFF, đúng
//                     config production; verify crypto cũng kết luận bỏ LPS)
//   L5 thoát        — stop cấu trúc gốc: đáy吸筹 60n − 7%; trailing bật khi
//                     giá ≥ đáy +15% → stop max(đỉnh 60n −10%, MA50 ×0.98);
//                     thoát cần 2 ngày đóng dưới stop, ngày "rửa chuồng"
//                     (vol < 0.8×ref) không tính; thâm hụt ≥5% dưới stop thoát
//                     NGAY; Upthrust sau phân phối + Distribution warning đúng
//                     ngưỡng gốc; THÊM thoát breadth RISK_OFF (thích nghi
//                     crypto — verify: SOS RISK_OFF −1.77%/28.6%)
//
// Long-only (gốc là cổ phiếu spot: tích luỹ → markup), lev 1 (WYC_LEV), stake
// 10% vốn chuỗi sổ C. Nhịp 20 phút trên nến NGÀY ĐÃ ĐÓNG. pm2 restart an toàn
// — toàn bộ state vị thế nằm trong dòng WyckoffBook (như sổ A).

import { db } from "./db";
import { tgSendMessage } from "./telegram-store";
import { fmtPrice } from "./i18n";
import { buildTradeHeader } from "./tg-msgs";
import { bumpSettledWallet, readUnifiedSettled } from "./unified-balance";
import { fetchKlinesDirect } from "./klines-direct";
import { feeRoi, pval } from "./params";
import {
  WYC_BIAS200_MAX,
  WYC_BREADTH_MIN,
  WYC_C_ON,
  WYC_DIST_BIAS,
  WYC_DIST_CONFIRM,
  WYC_EVR_MOVE,
  WYC_EVR_VOL,
  WYC_EXIT_CONFIRM,
  WYC_EXIT_SL_PCT,
  WYC_EXIT_VOL_WASH,
  WYC_L1_QUOTE_VOL,
  WYC_LEV,
  WYC_MA50_ANGLE_MIN,
  WYC_MARKUP_CONFIRM_DAYS,
  WYC_RPS120_MIN,
  WYC_RPS120_STRONG,
  WYC_RPS50_MIN,
  WYC_SPRING_EXPAND,
  WYC_SPRING_TR_DRIFT,
  WYC_SPRING_TR_MAX,
  WYC_SPRING_VOL,
  WYC_SPRING_WINDOW,
  WYC_SOS_BREAKOUT,
  WYC_SOS_PCT,
  WYC_SOS_TOL,
  WYC_SOS_VOL,
  WYC_SOS_VOL_Q,
  WYC_STAKE_PCT,
  WYC_TICK_MS,
  WYC_TP_LOOKBACK,
  WYC_TP_MAX,
  WYC_TP_MIN,
  WYC_TP_VOL,
  WYC_TRAIL_ACT,
  WYC_TRAIL_DD,
  WYC_UT_BACK,
  WYC_UT_BIAS,
  WYC_UT_BREAK,
  WYC_UT_SHADOW,
  WYC_UT_VOL,
} from "./params";
import { readWallet } from "./autostate";
import { bookCOn } from "./books-flags";
import { breadthPct, quantile, swingValues } from "./wyckoff-gate";
import { UNIVERSE } from "./universe";
import type { Kline } from "./types";

const DAY_MS = 86_400_000;

// ── helpers thuần (mỗi hàm port đúng một hàm gốc) ────────────────────────────

/** MA đơn giản trên mảng close — gốc dùng pandas rolling.mean(). */
function sma(vals: number[], w: number): Array<number | null> {
  const out: Array<number | null> = new Array(vals.length).fill(null);
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= w) sum -= vals[i - w];
    if (i >= w - 1) out[i] = sum / w;
  }
  return out;
}

/** _is_trading_range_context port — Spring phải xảy ra trong TR hợp lệ:
 *  range % của zone ≤ min(max(ATR%×4, 30%), 60%), drift ≤ 12%. */
export function isTradingRangeContext(zone: Kline[], full: Kline[]): boolean {
  if (zone.length === 0) return false;
  const hi = Math.max(...zone.map((k) => k.h));
  const lo = Math.min(...zone.map((k) => k.l));
  if (lo <= 0 || !Number.isFinite(hi)) return false;
  const rangePct = ((hi - lo) / lo) * 100;

  // ATR(20) trên df_full — gốc trrolling(20).mean() rồi lấy giá trị cuối
  let maxAllowed = pval("WYC_SPRING_TR_MAX", WYC_SPRING_TR_MAX);
  if (full.length > 20) {
    let prevC = full[0].c;
    const trs: number[] = [];
    for (let i = 0; i < full.length; i++) {
      const k = full[i];
      trs.push(Math.max(k.h - k.l, Math.abs(k.h - prevC), Math.abs(k.l - prevC)));
      prevC = k.c;
    }
    const atrSlice = trs.slice(-20);
    const atrMean = atrSlice.reduce((s, x) => s + x, 0) / atrSlice.length;
    const lastC = full[full.length - 1].c;
    if (atrMean > 0 && lastC > 0) {
      const atrPct = (atrMean / lastC) * 100;
      maxAllowed = Math.min(Math.max(atrPct * 4, maxAllowed), 60);
    }
  }
  if (rangePct > maxAllowed) return false;

  const c0 = zone[0].c;
  const cN = zone[zone.length - 1].c;
  if (c0 <= 0) return false;
  const drift = Math.abs(((cN - c0) / c0) * 100);
  return drift <= pval("WYC_SPRING_TR_DRIFT", WYC_SPRING_TR_DRIFT);
}

/** _spring_support_level port — median 5 swing low cuối của zone (window 3). */
export function springSupportLevel(zone: Kline[]): number {
  const lows = swingValues(zone.map((k) => k.l), "low", 3);
  if (lows.length >= 2) return quantile(lows.slice(-5).sort((a, b) => a - b), 0.5);
  return Math.min(...zone.map((k) => k.c));
}

export interface WyTrigger {
  kind: "spring" | "sos" | "evr" | "trend_pullback";
  score: number; // spring: % recovery · sos/evr: vol ratio · tp: 1−vol_ratio
  note: string;
}

/** _detect_spring port — nến NGÀY cuối (đã đóng) so với zone trước đó.
 *  Zone = -(window+2)..-2 (không chứa nến đang test và nến trước nó). */
export function detectSpring(d: Kline[]): WyTrigger | null {
  const w = pval("WYC_SPRING_WINDOW", WYC_SPRING_WINDOW);
  if (d.length < w + 2) return null;
  const zone = d.slice(-(w + 2), -2);
  if (!isTradingRangeContext(zone, d.slice(0, d.length - 2))) return null;
  const support = springSupportLevel(zone);
  const prev = d[d.length - 2];
  const last = d[d.length - 1];

  // prev hoặc last THẤP HƠN support (thủng trong ngày được chấp nhận như gốc)
  if (prev.l >= support && last.l >= support) return null;
  // last close phải thu hồi về TRÊN support
  if (last.c <= support) return null;

  // vol_avg = mean 4 nến cuối của tail(5) bỏ nến cuối — gốc tail(5).iloc[:-1]
  const volTail = d.slice(-5, -1).map((k) => k.v);
  const volAvg = volTail.reduce((s, x) => s + x, 0) / Math.max(volTail.length, 1);
  if (volAvg <= 0 || last.v < volAvg * pval("WYC_SPRING_VOL", WYC_SPRING_VOL)) return null;
  // vol_expand: vol thu hồi / vol thăm dò ≥ 1.15 (nến trước = thăm dò)
  const prevVol = prev.v;
  if (prevVol > 0 && last.v / prevVol < pval("WYC_SPRING_EXPAND", WYC_SPRING_EXPAND)) return null;

  const recovery = ((last.c - support) / support) * 100;
  return { kind: "spring", score: recovery, note: `Spring: thủng đáy ${support.toPrecision(6)} rồi đóng +${recovery.toFixed(2)}% · vol ${volAvg > 0 ? (last.v / volAvg).toFixed(2) : "—"}×` };
}

/** _sos_volume_ratio port — vol cuối ≥ ×20n ref VÀ ≥ quantile 0.95 của ref. */
function sosVolumeRatio(vol: number[]): number | null {
  const ref = vol.slice(-(60 + 1), -1);
  if (ref.length === 0) return null;
  const refAvg = ref.reduce((s, x) => s + x, 0) / ref.length;
  if (refAvg <= 0) return null;
  const last = vol[vol.length - 1];
  if (last / refAvg < pval("WYC_SOS_VOL", WYC_SOS_VOL)) return null;
  const q = quantile([...ref].sort((a, b) => a - b), pval("WYC_SOS_VOL_Q", WYC_SOS_VOL_Q));
  if (q > 0 && last < q) return null;
  return last / refAvg;
}

/** _detect_sos port — ngày cuối ≥ +6%, vol bùng nổ, breakout 60n (dung sai 1%)
 *  HOẶC crossover MA50. Score = vol ratio. */
export function detectSos(d: Kline[]): WyTrigger | null {
  const need = Math.max(60, pval("WYC_SOS_BREAKOUT", WYC_SOS_BREAKOUT)) + 2;
  if (d.length < need) return null;
  const closes = d.map((k) => k.c);
  const last = d[d.length - 1];
  const prev = d[d.length - 2];
  const dayPct = ((last.c - prev.c) / prev.c) * 100;
  if (dayPct < pval("WYC_SOS_PCT", WYC_SOS_PCT)) return null;

  const vr = sosVolumeRatio(d.map((k) => k.v));
  if (vr === null) return null;

  // breakout 60 ngày (bỏ nến cuối) — close ≥ max_high × (1 − 1%)
  const priorHighs = d.slice(-(pval("WYC_SOS_BREAKOUT", WYC_SOS_BREAKOUT) + 1), -1).map((k) => k.h);
  const maxHigh = Math.max(...priorHighs);
  const isBreakout = last.c >= maxHigh * (1 - pval("WYC_SOS_TOL", WYC_SOS_TOL));
  // crossover MA50: prev close ≤ MA50(prev) và last close > MA50(last)
  const ma50 = sma(closes, 50);
  const mLast = ma50[ma50.length - 1];
  const mPrev = ma50[ma50.length - 2];
  const isCross = mLast != null && mPrev != null && prev.c <= mPrev && last.c > mLast;
  if (!isBreakout && !isCross) return null;

  return { kind: "sos", score: vr, note: `SOS: +${dayPct.toFixed(2)}% · vol ${vr.toFixed(2)}× · ${isBreakout ? `breakout ${maxHigh.toPrecision(6)}` : "crossover MA50"}` };
}

/** _detect_evr port — "nỗ lực không thành quả": 1 nến vol ≥ 1.8× (trong cửa
 *  sổ 20 trừ 2 nến cuối) nhưng biên độ ±2% — nằm gần đáy (close ≥ close 3n
 *  trước × 0.98). Candidate idx −2 (confirm 1 ngày). */
export function detectEvr(d: Kline[]): WyTrigger | null {
  if (d.length < 20 + 2 + 1) return null;
  const volRef = d.slice(-(20), -2).map((k) => k.v);
  const refAvg = volRef.reduce((s, x) => s + x, 0) / Math.max(volRef.length, 1);
  if (refAvg <= 0) return null;
  const closes = d.map((k) => k.c);
  const last = d[d.length - 1];

  // confirm_days gốc = 1 → chỉ xét idx −2; ngày −1 phải giữ trên low của ngày event
  const idx = d.length - 2;
  const ev = d[idx];
  const vr = ev.v / refAvg;
  if (vr < pval("WYC_EVR_VOL", WYC_EVR_VOL)) return null;
  const pct = ((ev.c - d[idx - 1].c) / d[idx - 1].c) * 100;
  const mv = pval("WYC_EVR_MOVE", WYC_EVR_MOVE);
  if (pct < -mv || pct > mv) return null;
  // structure: close hôm nay ≥ close 3 ngày trước × 0.98 (không rơi khỏi đáy)
  if (closes.length >= 4 && last.c < closes[closes.length - 4] * 0.98) return null;
  // confirmation: close ngày −1 ≥ low event (allow_break 0%)
  const evLow = ev.l;
  if (d[d.length - 1].c < evLow) return null;

  return { kind: "evr", score: vr, note: `EVR: vol ${vr.toFixed(2)}× ngày ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% giữ đáy` };
}

/** _detect_trend_pullback port — MA20 đang dốc lên (10 ngày), pullback 5–20%
 *  trong cửa sổ 10 ngày, ngày cuối đóng HƠN hôm trước (đang ổn định), segment
 *  xuống có vol ≤ 0.6× segment lên. Score = 1 − vol_ratio. */
export function detectTrendPullback(d: Kline[]): WyTrigger | null {
  const look = pval("WYC_TP_LOOKBACK", WYC_TP_LOOKBACK);
  if (d.length < 20 + look + 5) return null;
  const closes = d.map((k) => k.c);
  const ma = sma(closes, 20);
  const mLast = ma[ma.length - 1];
  const mPrev = ma[ma.length - 1 - look];
  if (mLast == null || mPrev == null || mLast <= mPrev) return null;

  const recent = d.slice(-(look + 1));
  let peakIdx = 0;
  let peak = -Infinity;
  recent.forEach((k, i) => {
    if (k.c > peak) {
      peak = k.c;
      peakIdx = i;
    }
  });
  if (peakIdx < 1 || peak <= 0) return null;
  const afterPeak = recent.slice(peakIdx + 1);
  const trough = afterPeak.length ? Math.min(...afterPeak.map((k) => k.l)) : recent[recent.length - 1].c;
  const lastClose = closes[closes.length - 1];
  const pullback = ((peak - Math.min(trough, lastClose)) / peak) * 100;
  if (pullback < pval("WYC_TP_MIN", WYC_TP_MIN) || pullback > pval("WYC_TP_MAX", WYC_TP_MAX)) return null;
  if (lastClose <= closes[closes.length - 2]) return null; // chưa ổn định lại

  // vol thu hẹp: mean vol segment xuống (bỏ ngày đỉnh) / mean vol segment lên
  const volTail = d.slice(-(look + 1));
  const volUp = volTail.slice(0, peakIdx + 1);
  const volDown = volTail.slice(peakIdx + 1);
  const upMean = volUp.reduce((s, k) => s + k.v, 0) / Math.max(volUp.length, 1);
  if (upMean <= 0 || volDown.length === 0) return null;
  const downMean = volDown.reduce((s, k) => s + k.v, 0) / volDown.length;
  const volRatio = downMean / upMean;
  if (volRatio > pval("WYC_TP_VOL", WYC_TP_VOL)) return null;

  return { kind: "trend_pullback", score: 1 - volRatio, note: `TrendPullback: rút −${pullback.toFixed(2)}% rồi hồi, vol xuống ${volRatio.toFixed(2)}× vol lên` };
}

// ── L5 exit — port _compute_stop_loss / _stop_loss_exit_signal /
//    _detect_upthrust_after_distribution / _detect_distribution_start ─────────

export interface WyExitState {
  accumLow: number; // đáy吸筹 = min low 60 ngày trước entry
  stopPrice: number; // stop cấu trúc hiện hành
  stopKind: "accum" | "trailing";
  peak: number; // đỉnh cao nhất từ khi vào
  trailArmed: boolean;
}

/** _compute_stop_loss port — stage Accum: đáy吸筹 −7%; đã bật trailing
 *  (giá ≥ đáy +15%): max(đỉnh 60n ×0.90, MA50 ×0.98). */
export function wyckoffStopPrice(d: Kline[], st: WyExitState): { stop: number; kind: "accum" | "trailing"; reason: string } {
  const closes = d.map((k) => k.c);
  const lastClose = closes[closes.length - 1];
  const ma50s = sma(closes, 50);
  const ma50 = ma50s[ma50s.length - 1];
  const recentHigh = Math.max(st.peak, Math.max(...d.slice(-60).map((k) => k.h)));
  const trailArmed = lastClose >= st.accumLow * (1 + pval("WYC_TRAIL_ACT", WYC_TRAIL_ACT) / 100) || st.trailArmed;

  if (!trailArmed) {
    const stop = st.accumLow * (1 - pval("WYC_EXIT_SL_PCT", WYC_EXIT_SL_PCT) / 100);
    return { stop, kind: "accum", reason: `đáy吸筹 ${st.accumLow.toPrecision(6)} − ${pval("WYC_EXIT_SL_PCT", WYC_EXIT_SL_PCT)}%` };
  }
  const trailing = recentHigh * (1 - pval("WYC_TRAIL_DD", WYC_TRAIL_DD) / 100);
  const stop = ma50 != null ? Math.max(trailing, ma50 * 0.98) : trailing;
  return { stop, kind: "trailing", reason: "lời ≥ +15% đáy → trailing max(đỉnh−10%, MA50×0.98)" };
}

/** _stop_loss_exit_signal port — 2 ngày đóng dưới stop mới thoát; ngày
 *  "rửa chuồng" (vol < 0.8× ref 20n) KHÔNG tính; thâm hụt ≥ 5% thoát NGAY. */
export function stopLossExitSignal(d: Kline[], stop: number): { exit: boolean; deep: boolean; reason: string } | null {
  if (d.length < 3 || stop <= 0) return null;
  const lastClose = d[d.length - 1].c;
  if (lastClose > stop) return null;

  const deepBreach = (stop - lastClose) / stop >= 0.05;
  if (deepBreach) {
    return { exit: true, deep: true, reason: `deep breach: đóng ${lastClose.toPrecision(6)} dưới stop ${stop.toPrecision(6)} ≥ 5%` };
  }
  const confirm = pval("WYC_EXIT_CONFIRM", WYC_EXIT_CONFIRM);
  if (d.length < confirm) return null;
  const recentCloses = d.slice(-confirm);
  const allBelow = recentCloses.every((k) => k.c <= stop);
  if (!allBelow) return null;

  // vol wash filter — đủ 20+confirm nến mới áp; thiếu → coi như đã confirm
  const vol = d.map((k) => k.v);
  if (vol.length >= 20 + confirm) {
    const volRecent = vol.slice(-confirm).reduce((s, x) => s + x, 0) / confirm;
    const volRef = vol.slice(-(20 + confirm), -confirm).reduce((s, x) => s + x, 0) / 20;
    if (volRef > 0 && volRecent / volRef < pval("WYC_EXIT_VOL_WASH", WYC_EXIT_VOL_WASH)) {
      return { exit: false, deep: false, reason: "đóng dưới stop nhưng vol rửa chuồng — chờ confirm" };
    }
  }
  return { exit: true, deep: false, reason: `${confirm} ngày đóng dưới stop cấu trúc` };
}

/** _detect_upthrust_after_distribution port — thủng resistance (median 5 swing
 *  high 60n) ≥ +1%, đóng lại dưới resistance ≥ 0.3%, râu trên ≥ 35% biên ngày,
 *  vol ≥ 1.5× ref 20n, bias200 ≥ 15%. */
export function detectUpthrust(d: Kline[]): { reason: string } | null {
  const look = 60;
  if (d.length < Math.max(200, look) + 1) return null;
  const priorHighs = d.slice(-(look + 1), -1).map((k) => k.h);
  const swings = swingValues(priorHighs, "high", 3);
  const resistance = swings.length >= 2 ? quantile(swings.slice(-5).sort((a, b) => a - b), 0.5) : quantile([...priorHighs].sort((a, b) => a - b), 0.95);
  const closes = d.map((k) => k.c);
  const ma200s = sma(closes, 200);
  const ma200 = ma200s[ma200s.length - 1];
  const refVol = d.slice(-21, -1).map((k) => k.v);
  const refVolAvg = refVol.reduce((s, x) => s + x, 0) / Math.max(refVol.length, 1);
  const last = d[d.length - 1];
  if (!Number.isFinite(resistance) || resistance <= 0 || ma200 == null || ma200 <= 0 || refVolAvg <= 0) return null;

  const dayRange = last.h - last.l;
  const shadow = last.h - Math.max(last.o, last.c);
  const breakoutPct = (last.h / resistance - 1) * 100;
  const closeBackPct = last.c > 0 ? (resistance / last.c - 1) * 100 : 0;
  const volRatio = last.v / refVolAvg;
  const bias200 = (last.c / ma200 - 1) * 100;
  const shadowRatio = dayRange > 0 ? shadow / dayRange : 0;

  if (
    breakoutPct < pval("WYC_UT_BREAK", WYC_UT_BREAK) ||
    closeBackPct < pval("WYC_UT_BACK", WYC_UT_BACK) ||
    shadowRatio < pval("WYC_UT_SHADOW", WYC_UT_SHADOW) ||
    volRatio < pval("WYC_UT_VOL", WYC_UT_VOL) ||
    bias200 < pval("WYC_UT_BIAS", WYC_UT_BIAS)
  ) {
    return null;
  }
  return {
    reason: `Upthrust sau phân phối: thủng ${breakoutPct.toFixed(2)}% rồi đóng −${closeBackPct.toFixed(2)}% dưới resistance · râu ${Math.round(shadowRatio * 100)}% · vol ${volRatio.toFixed(2)}× · bias200 ${bias200.toFixed(2)}%`,
  };
}

/** _detect_distribution_start port — bias200 ≥ 30% + 3 ngày vol < 50% ref 60n. */
export function detectDistribution(d: Kline[]): { reason: string } | null {
  if (d.length < Math.max(200, 20) + 20) return null;
  const closes = d.map((k) => k.c);
  const ma200s = sma(closes, 200);
  const ma200 = ma200s[ma200s.length - 1];
  const lastClose = closes[closes.length - 1];
  if (ma200 == null || ma200 <= 0) return null;
  const bias = ((lastClose - ma200) / ma200) * 100;
  if (bias < pval("WYC_DIST_BIAS", WYC_DIST_BIAS)) return null;

  const vol = d.map((k) => k.v);
  const refVol = vol.slice(-60).reduce((s, x) => s + x, 0) / 60;
  const confirm = pval("WYC_DIST_CONFIRM", WYC_DIST_CONFIRM);
  const recentVol = vol.slice(-confirm).reduce((s, x) => s + x, 0) / confirm;
  if (refVol <= 0) return null;
  if (recentVol >= refVol * 0.5) return null;
  return { reason: `Distribution: bias200 +${bias.toFixed(2)}% + ${confirm} ngày vol ${((recentVol / refVol) * 100).toFixed(2)}% ref (khô ở đỉnh)` };
}

// ── L2 markup + RPS ───────────────────────────────────────────────────────────

export interface L2Readout {
  markupOk: boolean;
  reason: string;
  bias200: number;
  rps50: number;
  rps120: number;
}

/** L2 — markup cấu trúc + RPS percentile trong universe (đúng ngưỡng gốc). */
export function layer2(closes: number[], ret20: number, ret60: number, rpsMap: { ret20s: number[]; ret60s: number[] }): L2Readout {
  const ma50s = sma(closes, 50);
  const ma200s = sma(closes, 200);
  const m50 = ma50s[ma50s.length - 1];
  const m200 = ma200s[ma200s.length - 1];
  if (m50 == null || m200 == null) return { markupOk: false, reason: "chưa đủ nến cho MA50/MA200", bias200: 0, rps50: 0, rps120: 0 };

  const bias200 = ((closes[closes.length - 1] - m200) / m200) * 100;
  if (bias200 > pval("WYC_BIAS200_MAX", WYC_BIAS200_MAX)) {
    return { markupOk: false, reason: `bias200 +${bias200.toFixed(2)}% > ${pval("WYC_BIAS200_MAX", WYC_BIAS200_MAX)}% — quá nóng (gốc global_entry_max_bias_200)`, bias200, rps50: 0, rps120: 0 };
  }
  // markup confirm: MA50 > MA200 giữ N ngày liên tục
  const need = pval("WYC_MARKUP_CONFIRM_DAYS", WYC_MARKUP_CONFIRM_DAYS);
  let streak = 0;
  for (let i = 1; i <= Math.min(need, ma50s.length); i++) {
    const a = ma50s[ma50s.length - i];
    const b = ma200s[ma200s.length - i];
    if (a == null || b == null || a <= b) break;
    streak++;
  }
  if (streak < need) {
    return { markupOk: false, reason: `MA50 > MA200 mới giữ ${streak}/${need} ngày (markup_ma_crossover_confirm_days)`, bias200, rps50: 0, rps120: 0 };
  }
  // góc MA50 — % thay đổi MA50 trong 5 ngày
  const m50Prev = ma50s[ma50s.length - 6];
  if (m50Prev != null && m50Prev > 0) {
    const angle = ((m50 - m50Prev) / m50Prev) * 100;
    if (angle < pval("WYC_MA50_ANGLE_MIN", WYC_MA50_ANGLE_MIN)) {
      return { markupOk: false, reason: `góc MA50 ${angle.toFixed(2)}%/5d < ${pval("WYC_MA50_ANGLE_MIN", WYC_MA50_ANGLE_MIN)}%`, bias200, rps50: 0, rps120: 0 };
    }
  }
  // RPS percentile trong universe
  const rankOf = (val: number, arr: number[]): number => {
    if (arr.length === 0) return 0;
    const below = arr.filter((x) => x <= val).length;
    return Math.round((below / arr.length) * 1000) / 10;
  };
  const rps50 = rankOf(ret20, rpsMap.ret20s);
  const rps120 = rankOf(ret60, rpsMap.ret60s);
  const rps50Min = pval("WYC_RPS50_MIN", WYC_RPS50_MIN);
  const rps120Min = pval("WYC_RPS120_MIN", WYC_RPS120_MIN);
  if (rps120 < rps120Min) {
    return { markupOk: false, reason: `RPS120 ${rps120.toFixed(2)} < ${rps120Min}`, bias200, rps50, rps120 };
  }
  // bypass gốc: RPS120 ≥ 80 → RPS50 chỉ cần ≥ 50
  const strong = rps120 >= pval("WYC_RPS120_STRONG", WYC_RPS120_STRONG);
  const need50 = strong ? 50 : rps50Min;
  if (rps50 < need50) {
    return { markupOk: false, reason: `RPS50 ${rps50.toFixed(2)} < ${need50}${strong ? " (bypass strong)" : ""}`, bias200, rps50, rps120 };
  }
  return { markupOk: true, reason: `markup OK · bias200 ${bias200.toFixed(2)}% · RPS ${rps50.toFixed(2)}/${rps120.toFixed(2)}`, bias200, rps50, rps120 };
}

// ── sổ C — chuỗi vốn + tick ───────────────────────────────────────────────────

interface DailyCache {
  at: number;
  klines: Kline[];
}
const dailyCache = new Map<string, DailyCache>();
const DAILY_TTL = 15 * 60_000;

async function daily(symbol: string, tf = "1d"): Promise<Kline[] | null> {
  const key = symbol + ":" + tf;
  const hit = dailyCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < DAILY_TTL) return hit.klines;
  try {
    const kl = await fetchKlinesDirect(symbol, tf, 260);
    // chỉ nến ngày ĐÃ ĐÓNG
    const tfMs = tf === "1h" ? 3600_000 : tf === "4h" ? 4 * 3600_000 : DAY_MS;
    const closed = kl.filter((k) => k.t + tfMs <= now);
    if (closed.length < 60) return null;
    dailyCache.set(key, { at: now, klines: closed });
    return closed;
  } catch {
    return null;
  }
}

async function wyckoffChainHead(): Promise<number> {
  const last = await db.wyckoffBook.findFirst({ where: { status: "closed" }, orderBy: { exitTime: "desc" } });
  if (last?.capitalAfter != null) return last.capitalAfter;
  const wallet = await readWallet();
  return wallet.capital ?? 1000;
}

/** % nến giảm giá trung bình quote volume 20 ngày (USDT) — L1 crypto. */
function quoteVol20(d: Kline[]): number {
  const z = d.slice(-20);
  return z.reduce((s, k) => s + k.v * k.c, 0) / Math.max(z.length, 1);
}

let lastStatus = "";
let lastBreadth: number | null = null;
let lastTickAt = 0;
function logStatus(s: string): void {
  lastTickAt = Date.now();
  if (s !== lastStatus) {
    lastStatus = s;
    console.log(`[wyckoff-C] ${s}`);
  }
}

/** Trạng thái sổ C cho UI (/auto StrategyCards, qua engineSnapshot). */
export function wyckoffEngineStatus(): { breadth: number | null; status: string; tickAt: number } {
  return { breadth: lastBreadth, status: lastStatus, tickAt: lastTickAt };
}

async function wyckoffTick(): Promise<void> {
  const syms = [...UNIVERSE];
  const openRow = await db.wyckoffBook.findFirst({ where: { status: "open" } });
  const breadth = await breadthPct(syms);
  const breadthVal = breadth?.pct ?? null;
  lastBreadth = breadthVal;
  const riskOn = breadthVal !== null && breadthVal >= pval("WYC_BREADTH_MIN", WYC_BREADTH_MIN);

  // ── L5 exit cho vị thế đang mở (chạy DÙ C bật hay tắt) ──────────────────────
  if (openRow) {
    const d = await daily(openRow.symbol);
    if (d && d.length >= 60) {
      const st: WyExitState = {
        accumLow: openRow.accumLow > 0 ? openRow.accumLow : Math.min(...d.slice(-60).map((k) => k.l)),
        stopPrice: openRow.stopPrice,
        stopKind: openRow.stopKind === "trailing" ? "trailing" : "accum",
        peak: Math.max(openRow.peak, ...d.slice(-10).map((k) => k.h)),
        trailArmed: openRow.trailArmed,
      };
      const { stop, kind, reason: stopReason } = wyckoffStopPrice(d, st);
      const trailingNow = kind === "trailing" && stop > openRow.stopPrice;
      if (trailingNow || openRow.stopPrice !== stop || openRow.stopKind !== kind) {
        await db.wyckoffBook.update({
          where: { id: openRow.id },
          data: { stopPrice: stop, stopKind: kind, trailArmed: true, peak: st.peak },
        });
      }

      let exitKind: string | null = null;
      let exitReason = "";
      const sl = stopLossExitSignal(d, stop);
      if (sl?.exit) {
        exitKind = kind === "trailing" ? "trailing" : "sl";
        exitReason = `${stopReason} — ${sl.reason}`;
      } else {
        const ut = detectUpthrust(d);
        if (ut) {
          exitKind = "upthrust";
          exitReason = ut.reason;
        } else {
          const dist = detectDistribution(d);
          if (dist) {
            exitKind = "distribution";
            exitReason = dist.reason;
          } else if (!riskOn && breadthVal !== null) {
            exitKind = "breadth";
            exitReason = `breadth ${breadthVal}% < ${pval("WYC_BREADTH_MIN", WYC_BREADTH_MIN)} — RISK_OFF thoát (thích nghi verify 07/11)`;
          }
        }
      }

      if (exitKind) {
        const price = d[d.length - 1].c;
        const raw = (price - openRow.entryPrice) / openRow.entryPrice;
        const movePct = Math.round(raw * 100 * 100) / 100;
        const pnlPct = Math.round((movePct * WYC_LEV - feeRoi(WYC_LEV)) * 100) / 100;
        const before = openRow.capitalBefore ?? (await wyckoffChainHead());
        const delta = Math.round(before * (pval("WYC_STAKE_PCT", WYC_STAKE_PCT) / 100) * (pnlPct / 100) * 100) / 100;
        const after = Math.max(0, Math.round((before + delta) * 100) / 100);
        await db.wyckoffBook.update({
          where: { id: openRow.id },
          data: {
            status: "closed",
            exitPrice: price,
            exitTime: new Date(),
            exitKind,
            exitReason,
            movePct,
            pnlPct,
            capitalAfter: after,
          },
        });
        await bumpSettledWallet(delta).catch(() => null);
        console.log(`[wyckoff-C] CLOSE LONG ${openRow.symbol} @ ${price} (${exitKind}) move ${movePct}% ROI ${pnlPct}% vốn ${before}→${after} — ${exitReason}`);
        // D4 — Telegram CLOSE sổ C (fire-and-forget, cùng style OPEN C)
        void tgSendMessage(
          [
            `CLOSE C - LONG ${openRow.symbol}`,
            `Exit ${price} - ${exitKind.toUpperCase()} - So C Wyckoff`,
            `Move ${movePct}% - ROI ${pnlPct}%`,
            `Von ${before} -> ${after} (lev x${WYC_LEV}, stake ${WYC_STAKE_PCT}%)`,
          ].join(String.fromCharCode(10)),
          "HTML",
          { dedupeKey: `close:C:${openRow.id}` },
        ).catch(() => {});
        return;
      }
      logStatus(`giữ LONG ${openRow.symbol} · stop ${stop.toPrecision(6)} (${openRow.stopKind})${breadthVal !== null ? ` · breadth ${breadthVal}%` : ""}`);
      return; // một vị thế toàn cục — thoát trước khi quét entry
    }
  }

  // ── L1→L4 phễu entry (chỉ khi C bật, breadth RISK_ON và chưa có vị thế) ─────
  if (!pval("WYC_C_ON", WYC_C_ON) || !bookCOn()) {
    logStatus("sổ C đang TẮT — chỉ quản lý exit (đặt lại bằng toggle chiến lược /auto)");
    return;
  }
  if (openRow) return;
  if (!riskOn) {
    logStatus(`RISK_OFF (breadth ${breadthVal ?? "?"}%) — phễu C dừng, không vào lệnh mới`);
    return;
  }

  // fetch daily toàn universe (cache 15 phút)
  const dailies = new Map<string, Kline[]>();
  for (const tf of ["1h", "4h", "1d"]) for (const sym of syms) {
    const d = await daily(sym, tf);
    if (d) dailies.set(sym + ":" + tf, d);
  }
  // RPS input: ret20/ret60 toàn universe (nến ngày: 20/60 ngày)
  const ret20s: number[] = [];
  const ret60s: number[] = [];
  for (const [, d] of dailies) {
    const n = d.length;
    if (n > 21) ret20s.push((d[n - 1].c / d[n - 21].c - 1) * 100);
    if (n > 61) ret60s.push((d[n - 1].c / d[n - 61].c - 1) * 100);
  }

  const candidates: Array<{ sym: string; trig: WyTrigger; note: string; tf: string }> = [];
  for (const [key, d] of dailies) {
    const sym = key.split(":")[0];
    const tf = key.split(":")[1];
    if (!d || d.length < 200) continue; // L2 cần MA200; Spring cần 62
    // L1 thanh khoản — quote vol 20 ngày
    if (quoteVol20(d) < pval("WYC_L1_QUOTE_VOL", WYC_L1_QUOTE_VOL)) continue;
    // L2 markup + RPS
    const ret20 = (d[d.length - 1].c / d[d.length - 21].c - 1) * 100;
    const ret60 = (d[d.length - 1].c / d[d.length - 61].c - 1) * 100;
    const l2 = layer2(d.map((k) => k.c), ret20, ret60, { ret20s, ret60s });
    if (!l2.markupOk) continue;
    // L4 trigger — SOS ưu tiên (breakout > fake-out, đúng như gốc cho SOS check sau Spring)
    const trig =
      detectSos(d) ??
      detectSpring(d) ??
      detectEvr(d) ??
      detectTrendPullback(d);
    if (!trig) continue;
    candidates.push({ sym, trig, note: "[" + tf + "] " + trig.note + " · " + l2.reason, tf });
  }

  if (candidates.length === 0) {
    logStatus(`phễu C: 0/${syms.length} symbol qua L1→L4${breadthVal !== null ? ` · breadth ${breadthVal}%` : ""}`);
    return;
  }
  // chọn score cao nhất — SOS vol ratio thường 3+, Spring recovery nhỏ →
  // chuẩn hoá: sos/evr ratio giữ nguyên, spring×10, tp×10 (cùng thang ~0–10)
  const norm = (t: WyTrigger): number => (t.kind === "spring" ? t.score * 10 : t.kind === "trend_pullback" ? t.score * 10 : t.score);
  candidates.sort((a, b) => norm(b.trig) - norm(a.trig));
  const pick = candidates[0];
  const d = dailies.get(pick.sym + ":" + pick.tf)!;
  const head = await wyckoffChainHead();
  const entry = d[d.length - 1].c;
  const accumLow = Math.min(...d.slice(-60).map((k) => k.l));
  const { stop } = wyckoffStopPrice(d, {
    accumLow,
    stopPrice: 0,
    stopKind: "accum",
    peak: Math.max(...d.slice(-10).map((k) => k.h)),
    trailArmed: false,
  });
  await db.wyckoffBook.create({
    data: {
      symbol: pick.sym,
      side: "LONG",
      trigger: pick.trig.kind,
      score: Math.round(pick.trig.score * 100) / 100,
      breadth: breadthVal,
      entryPrice: entry,
      status: "open",
      stopPrice: stop,
      stopKind: "accum",
      accumLow,
      peak: Math.max(...d.slice(-10).map((k) => k.h)),
      trailArmed: false,
      capitalBefore: head,
    },
  });
  console.log(`[wyckoff-C] OPEN LONG ${pick.sym} @ ${entry} trigger ${pick.trig.kind} score ${pick.trig.score.toFixed(2)} stop ${stop.toPrecision(6)} (đáy ${accumLow.toPrecision(6)}) vốn ${head} · ${pick.note}${candidates.length > 1 ? ` · ${candidates.length} ứng viên, chọn score cao nhất` : ""}`);
    const unifiedBalC = await readUnifiedSettled().then((u) => u.balance).catch(() => undefined);
    void tgSendMessage(
      [
      ...buildTradeHeader("📡", "OPEN", { symbol: pick.sym, interval: "1d", side: "LONG", book: "C" }),
      `🎯 Entry <b>${fmtPrice(Number(entry))}</b>`,
      `🛑 Stop Loss <b>${fmtPrice(Number(stop))}</b> · Wyckoff trigger: ${pick.trig.kind} · Trigger score ${pick.trig.score.toFixed(2)}`,
      "",
      `⚖️ Leverage ×1 · Stake 10% of Balance`,
      "",
      ...(unifiedBalC != null ? [`💰 Balance <b>${unifiedBalC.toFixed(2)}</b> USDT`] : []),
      ].join("\n"),
      "HTML",
      { dedupeKey: `open:C:${pick.sym}:${entry}` },
    ).catch(() => {});
}

let cStarted = false;

/** Tick sổ C có báo trạng thái: mọi lỗi đều THẤY trên card C (/auto) — hết kẹt
 *  "booting first tick" vĩnh viễn khi dữ liệu/DB trục trặc (0.2.99). */
async function wyckoffTickStatus(): Promise<void> {
  try {
    await wyckoffTick();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logStatus(`lỗi tick: ${msg} — sẽ thử lại tick kế`);
    console.error(`[wyckoff-C] tick: ${msg}`);
  }
}

/** Khởi động nhịp sổ C — gọi MỘT lần lúc boot (engine.ts). */
export function startWyckoffEngine(): void {
  if (cStarted) return;
  cStarted = true;
  const boot = setTimeout(() => {
    void wyckoffTickStatus();
    const arm = (): void => {
      const t = setTimeout(() => {
        void wyckoffTickStatus();
        arm();
      }, pval("WYC_TICK_MS", WYC_TICK_MS));
      t.unref?.();
    };
    arm();
  }, 50_000);
  boot.unref?.();
  console.warn(`[wyckoff-C] engine sổ C khởi động — phễu Wyckoff gốc 5 lớp trên nến ngày, ${UNIVERSE.length} symbol, lev ${WYC_LEV}, stake ${pval("WYC_STAKE_PCT", WYC_STAKE_PCT)}%, bảng WyckoffBook`);
}
