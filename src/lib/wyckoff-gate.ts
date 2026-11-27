// ─── wyckoff-gate — cổng cấu trúc Wyckoff cho lệnh LONG sổ B (0.2.96) ─────────
// Port 1-1 từ scripts/verify-wyckoff-crypto.py — phiên bản đã walk-forward
// kiểm chứng trên ~19 symbol × 2.7 năm nến ngày (07/11/2026):
//   · baseline chop −0.14%/45.6%   · Gate Spring|SOS + breadth≥50 = +3.87%/58.7%
//   · SOS khi RISK_ON +7.10%/65.2% vs RISK_OFF −1.77%/28.6% → regime BẮT BUỘC.
// Chỉ dùng ĐÚNG phần đã verify, không thêm phần chưa test:
//   · range 90 nến ngày: width 3–60%, drift ≤25%, test ≥1 mặt mỗi biên
//   · Spring: vol ≥ 1.3×(5 nến), thủng đáy ≤ 99.5%, đóng > 100.5% đáy,
//     đóng < mid + 25% width
//   · SOS: nến ngày đóng ≥ +6% và vol ≥ 3×(20 nến), close ≥ 99% resistance
//   · breadth: % symbol universe có close ngày ≥ MA20 ≥ WY_BREADTH_MIN
//   · Upthrust veto: nến thủng đỉnh rồi đóng lại dưới đỉnh → chặn LONG (L5)
// Sổ B vẫn là engine Elliott/XGBoost — cổng này chỉ chặn lệnh LONG sai cấu
// trúc (bài toán sổ B 08/11: 13 lệnh/9h, LONG net −2.53% vs SHORT +45.23%).
// Lỗi dữ liệu → FAIL-OPEN (kẹt data không được giết engine), ghi rõ lý do.

import { fetchKlinesDirect } from "./klines-direct";
import { pval, WYCKOFF_GATE, WY_RANGE_LOOKBACK, WY_RANGE_MIN_W, WY_RANGE_MAX_W, WY_DRIFT_MAX, WY_SPRING_VOL, WY_SOS_PCT, WY_SOS_VOL, WY_BREADTH_MIN, WY_UPTHRUST_VETO, WY_BREADTH_TTL_MS } from "./params";
import type { Kline } from "./types";

const DAY_MS = 86_400_000;

export interface WyckoffRange {
  support: number;
  resistance: number;
  mid: number;
  width: number;
  widthPct: number;
  driftPct: number;
  sTests: number;
  rTests: number;
  atrPct: number;
  quality: number;
}

export interface WyckoffVerdict {
  ok: boolean;
  side: "LONG";
  symbol: string;
  reason: string; // lý do chặn (ok=false) hoặc mô tả pass
  trigger: "spring" | "sos" | "none";
  range: WyckoffRange | null;
  breadth: number | null; // % universe trên MA20
  regime: "RISK_ON" | "RISK_OFF" | "unknown";
  upthrust: boolean;
  suggestedStopPct: number | null; // stop cấu trúc (đáy spring − 0.5×ATR ngày) — thông tin, engine SL tự lo
  failOpen: boolean;
}

// ── helpers thuần (test độc lập được) ────────────────────────────────────────

/** Quantile kiểu pandas (linear interpolation) trên mảng số sạch. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Pivot Wyckoff: tâm i là swing low/high khi value[i] == min/max của cửa sổ
 *  ±w (không strict — đáy phẳng vẫn tính, đúng swing_values trong verify). */
export function swingValues(vals: number[], kind: "low" | "high", window: number): number[] {
  const w = Math.max(Math.floor(window), 1);
  const out: number[] = [];
  for (let i = w; i < vals.length - w; i++) {
    const cur = vals[i];
    if (!Number.isFinite(cur)) continue;
    let boundary = kind === "low" ? Infinity : -Infinity;
    let empty = true;
    for (let j = i - w; j <= i + w; j++) {
      const v = vals[j];
      if (!Number.isFinite(v)) continue;
      empty = false;
      boundary = kind === "low" ? Math.min(boundary, v) : Math.max(boundary, v);
    }
    if (!empty && cur === boundary) out.push(cur);
  }
  return out;
}

/** vol cuối / mean vol cửa sổ trước đó (bỏ nến cuối — last_ref_volume_ratio). */
export function lastRefVolRatio(vol: number[], window: number): number | null {
  if (vol.length < window + 1) return null;
  const ref = vol.slice(-(window + 1), -1).filter(Number.isFinite);
  const mean = ref.reduce((s, x) => s + x, 0) / ref.length;
  const last = vol[vol.length - 1];
  if (!Number.isFinite(last) || ref.length === 0 || mean <= 0) return null;
  return last / mean;
}

/** nhận diện range 90 nến ngày (zone trừ nến cuối) — port identify_trading_range. */
export function identifyTradingRange(d: Kline[], lookback = 90, swingWindow = 3, excludeLast = 1, overrides?: { minW?: number; maxW?: number; driftMax?: number }): WyckoffRange | null {
  const minBars = Math.max(40, swingWindow * 2 + 20);
  if (d.length < minBars + Math.max(excludeLast, 0)) return null;
  const zone = d.slice(0, d.length - Math.max(excludeLast, 0)).slice(-Math.max(lookback, minBars));
  if (zone.length < minBars) return null;
  const high = zone.map((k) => k.h);
  const low = zone.map((k) => k.l);
  const close = zone.map((k) => k.c);
  if (!high.length || low.some((x) => !Number.isFinite(x))) return null;

  const swLows = swingValues(low, "low", swingWindow);
  const swHighs = swingValues(high, "high", swingWindow);
  const sortedLow = [...low].filter(Number.isFinite).sort((a, b) => a - b);
  const sortedHigh = [...high].filter(Number.isFinite).sort((a, b) => a - b);
  const last5Lows = swLows.slice(-5).sort((a, b) => a - b);
  const last5Highs = swHighs.slice(-5).sort((a, b) => a - b);
  const support = last5Lows.length >= 2 ? quantile(last5Lows, 0.5) : quantile(sortedLow, 0.10);
  const resistance = last5Highs.length >= 2 ? quantile(last5Highs, 0.5) : quantile(sortedHigh, 0.90);
  if (!Number.isFinite(support) || !Number.isFinite(resistance) || support <= 0 || resistance <= support) return null;

  const widthPct = ((resistance - support) / support) * 100;
  const maxW = overrides?.maxW ?? pval("WY_RANGE_MAX_W", WY_RANGE_MAX_W);
  const minW = overrides?.minW ?? pval("WY_RANGE_MIN_W", WY_RANGE_MIN_W);
  if (widthPct < minW || widthPct > maxW) return null;

  const clean = close.filter(Number.isFinite);
  const first = clean[0];
  const last = clean[clean.length - 1];
  if (!Number.isFinite(first) || first <= 0 || !Number.isFinite(last)) return null;
  const driftPct = Math.abs(((last - first) / first) * 100);
  const driftMax = overrides?.driftMax ?? pval("WY_DRIFT_MAX", WY_DRIFT_MAX);
  if (driftPct > driftMax) return null;

  const tol = 0.035;
  const sTests = low.filter((x) => x <= support * (1 + tol)).length;
  const rTests = high.filter((x) => x >= resistance * (1 - tol)).length;
  if (sTests < 2 || rTests < 2) return null;

  // ATR% (TR trên zone, mean 20 nến cuối) — cho quality score
  let prevClose = NaN;
  const trs: number[] = [];
  for (let i = 0; i < zone.length; i++) {
    const h = high[i], l = low[i], c = close[i];
    const tr = Math.max(h - l, Number.isFinite(prevClose) ? Math.abs(h - prevClose) : h - l, Number.isFinite(prevClose) ? Math.abs(l - prevClose) : h - l);
    trs.push(tr);
    prevClose = c;
  }
  const atr = trs.slice(-20).reduce((s, x) => s + x, 0) / Math.max(Math.min(20, trs.length), 1);
  const atrPct = last > 0 && Number.isFinite(atr) ? (atr / last) * 100 : 0;

  const idealWidth = Math.min(Math.max(atrPct * 4, 6), 40);
  const widthScore = Math.max(0, 1 - Math.abs(widthPct - idealWidth) / Math.max(idealWidth, 1));
  const testScore = Math.min((sTests + rTests) / 6, 1);
  const driftScore = Math.max(0, 1 - driftPct / driftMax);
  const quality = 0.45 * testScore + 0.35 * widthScore + 0.20 * driftScore;

  return {
    support,
    resistance,
    mid: support + (resistance - support) / 2,
    width: resistance - support,
    widthPct,
    driftPct,
    sTests,
    rTests,
    atrPct,
    quality,
  };
}

/** Trigger trên nến ngày ĐÃ ĐÓNG cuối so với range trước đó — port detect_triggers
 *  (chỉ Spring + SOS, đúng 2 trigger đã verify có edge; LPS/EVR bị bỏ vì verify
 *  chỉ ra LPS ồn, EVR hiếm không đủ mẫu). */
export function detectTriggers(d: Kline[], tr: WyckoffRange, overrides?: { sosPct?: number }): { trigger: "spring" | "sos" | "none"; upthrust: boolean } {
  const n = d.length;
  if (n < 3) return { trigger: "none", upthrust: false };
  const vol = d.map((k) => k.v);
  const { mid, support, resistance, width } = tr;
  // Upthrust chỉ check nến cuối — failed breakout mới nhất
  const lastHigh = d[n - 1].h;
  const lastClose = d[n - 1].c;
  const upthrust = lastHigh > resistance * 1.005 && lastClose < resistance * 0.995;
  // Quét 5 nến ngày cuối — Spring/SOS có hiệu lực vài ngày, không phải 1 ngày
  const lookback = Math.max(1, Math.min(5, n - 1));
  for (let i = n - lookback; i < n; i++) {
    const cur = d[i];
    const prev = d[i - 1];
    if (!cur || !prev) continue;
    const volSlice = vol.slice(0, i + 1);
    // Spring ở nến i
    const vrSpring = lastRefVolRatio(volSlice, 5);
    const pierced = Math.min(prev.l, cur.l) <= support * 0.995;
    const recovered = cur.c > support * 1.005;
    const inRange = cur.c < mid + width * 0.25;
    if (vrSpring !== null && pierced && recovered && inRange && vrSpring >= pval("WY_SPRING_VOL", WY_SPRING_VOL)) {
      return { trigger: "spring", upthrust };
    }
    // SOS ở nến i — breakout mạnh hơn fake-out
    const vrSos = lastRefVolRatio(volSlice, Math.max(20, 5));
    const pctChg = Number.isFinite(prev.c) && prev.c > 0 ? ((cur.c - prev.c) / prev.c) * 100 : 0;
    const breakout = cur.c >= resistance * 0.99;
    const sosPct = overrides?.sosPct ?? pval("WY_SOS_PCT", WY_SOS_PCT);
    if (vrSos !== null && breakout && pctChg >= sosPct && vrSos >= pval("WY_SOS_VOL", WY_SOS_VOL)) {
      return { trigger: "sos", upthrust };
    }
  }
  return { trigger: "none", upthrust };
}

// ── breadth regime: % symbol universe có close ngày ≥ MA20 (cache 30 phút) ───

interface BreadthCache {
  pct: number;
  n: number;
  at: number;
  dateKey: string;
}
let breadthCache: BreadthCache | null = null;
const symKlineCache = new Map<string, { above: boolean; at: number }>();
const SYM_KLINE_TTL = 60 * 60_000;

function dayKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** % symbol có close ngày (nến đã đóng gần nhất) ≥ MA20. Symbol lỗi bị loại
 *  khỏi mẫu (không fail gate); 0 symbol đọc được → null (fail-open phía gọi). */
export async function breadthPct(symbols: string[]): Promise<{ pct: number; n: number } | null> {
  const now = Date.now();
  const ttl = pval("WY_BREADTH_TTL_MS", WY_BREADTH_TTL_MS);
  const today = dayKey(now);
  if (breadthCache && breadthCache.dateKey === today && now - breadthCache.at < ttl) {
    return { pct: breadthCache.pct, n: breadthCache.n };
  }
  const list = [...new Set(symbols.map((s) => s.toUpperCase()))].slice(0, 40);
  if (list.length === 0) return null;
  const results = await Promise.allSettled(
    list.map(async (sym) => {
      const hit = symKlineCache.get(sym);
      if (hit && now - hit.at < SYM_KLINE_TTL) return hit.above;
      const kl = await fetchKlinesDirect(sym, "1d", 25);
      const closed = kl.filter((k) => k.t + DAY_MS <= now);
      if (closed.length < 20) throw new Error("thin klines");
      const closes = closed.map((k) => k.c).slice(-20);
      const ma20 = closes.reduce((s, x) => s + x, 0) / 20;
      const above = closed[closed.length - 1].c >= ma20;
      symKlineCache.set(sym, { above, at: now });
      return above;
    }),
  );
  const votes = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<boolean>).value);
  if (votes.length === 0) return null;
  const pct = Math.round((votes.filter(Boolean).length / votes.length) * 1000) / 10;
  breadthCache = { pct, n: votes.length, at: now, dateKey: today };
  return { pct, n: votes.length };
}

// ── verdict chính — gọi từ engine trước khi mở lệnh LONG ─────────────────────

// ── Scale ngưỡng Wyckoff theo TF (v0.3.42) ────────────────────────────────
// Verify 07/11 chỉ có trên 1d: width 4%, SOS +6%, drift 18%.
// Xuống TF nhỏ, biến động 1 nến nhỏ lại theo căn thời gian, nên ngưỡng phải nhỏ lại.
// Nếu giữ ngưỡng 1d cho 1h/4h thì LONG 1h/4h gần như không bao giờ qua.
export const WY_TF_SCALE: Record<string, { rangeMin: number; sosPct: number; driftMax: number }> = {
  "1m":  { rangeMin: 0.25, sosPct: 0.25, driftMax: 1.0 },
  "5m":  { rangeMin: 0.5, sosPct: 0.5, driftMax: 2 },
  "15m": { rangeMin: 0.8, sosPct: 0.8, driftMax: 3 },
  "30m": { rangeMin: 1.2, sosPct: 1.2, driftMax: 4 },
  "1h":  { rangeMin: 1.5, sosPct: 1.5, driftMax: 10 },
  "4h":  { rangeMin: 2.5, sosPct: 3.0, driftMax: 15 },
  "1d":  { rangeMin: 3.0, sosPct: 6.0, driftMax: 25 },
};
export function wyTfScale(interval: string) {
  return WY_TF_SCALE[interval] ?? WY_TF_SCALE["1d"];
}

/** Cổng LONG sổ B. Data lỗi → fail-open (ok=true, failOpen=true, lý do ghi rõ). */
export async function wyckoffLongGate(symbol: string, universe: string[], interval = "1d"): Promise<WyckoffVerdict> {
  const sym = symbol.toUpperCase();
  const base: Omit<WyckoffVerdict, "ok" | "reason" | "trigger" | "range" | "breadth" | "regime" | "upthrust" | "suggestedStopPct" | "failOpen"> = { side: "LONG", symbol: sym };
  if (!pval("WYCKOFF_GATE", WYCKOFF_GATE)) {
    return { ...base, ok: true, reason: "gate off (WYCKOFF_GATE=0)", trigger: "none", range: null, breadth: null, regime: "unknown", upthrust: false, suggestedStopPct: null, failOpen: false };
  }
  try {
    const now = Date.now();
    // FIX v0.3.42: Multi-TF 1h/4h/1d như sổ D — NHƯNG scale ngưỡng theo TF.
    // V0.3.41 ép về 1d là rollback, v0.3.42 khôi phục multi-TF + scale đúng.
    // Ngưỡng ngày (width 4%, SOS +6%, drift 18%) không xài được cho 1h/4h.
    const tfMs: Record<string, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "4h": 14_400_000, "1d": DAY_MS };
    const intervalMs = tfMs[interval] ?? DAY_MS;
    const lookback = interval === "1d" ? Math.max(pval("WY_RANGE_LOOKBACK", WY_RANGE_LOOKBACK) + 60, 150) : Math.max(pval("WY_RANGE_LOOKBACK", WY_RANGE_LOOKBACK) * 2 + 60, 240);
    const raw = await fetchKlinesDirect(sym, interval, lookback);
    // chỉ nến ngày ĐÃ ĐÓNG — nến đang chạy không đủ tư cách làm trigger
    const d = raw.filter((k) => k.t + intervalMs <= now);
    if (d.length < 120) {
      return { ...base, ok: true, reason: `fail-open: chỉ ${d.length} nến ${interval} đã đóng`, trigger: "none", range: null, breadth: null, regime: "unknown", upthrust: false, suggestedStopPct: null, failOpen: true };
    }
    const tfScale = wyTfScale(interval);
    // v0.3.43: truyền ngưỡng đã scale theo TF vào identify + detect
    // 1h: width ≥1.5%, SOS ≥1.5%, drift ≤6% · 4h: width ≥2.5%, SOS ≥3%, drift ≤10% · 1d: 4% / 6% / 18%
    const tr = identifyTradingRange(d, pval("WY_RANGE_LOOKBACK", WY_RANGE_LOOKBACK), 3, 1, { minW: tfScale.rangeMin, driftMax: tfScale.driftMax });
    const { trigger, upthrust } = tr ? detectTriggers(d, tr, { sosPct: tfScale.sosPct }) : { trigger: "none" as const, upthrust: false };
    const br = await breadthPct(universe);
    const breadth = br ? br.pct : null;
    const breadthMin = pval("WY_BREADTH_MIN", WY_BREADTH_MIN);
    const regime = breadth === null ? "unknown" : breadth >= breadthMin ? "RISK_ON" : "RISK_OFF";

    const lastClose = d[d.length - 1].c;
    const suggestedStopPct =
      tr && lastClose > 0 ? Math.max(((lastClose - (tr.support - 0.5 * (tr.atrPct / 100) * lastClose)) / lastClose) * 100, 0.1) : null;

    if (tr && upthrust && pval("WY_UPTHRUST_VETO", WY_UPTHRUST_VETO)) {
      return { ...base, ok: false, reason: `Upthrust — nến ${interval} thủng đỉnh ${fmt(tr.resistance)} rồi đóng lại dưới đỉnh (failed breakout)`, trigger, range: tr, breadth, regime, upthrust: true, suggestedStopPct, failOpen: false };
    }
    if (!tr) {
      // Trend fallback: không có range vì đang trend (drift >18% / width >45%)
      // mà breadth ≥ min + RISK_ON + close > MA20 (20 nến 1d) thì cho LONG qua
      // lý do: trend lên không cần range tích lũy — bắt trend phải có range là chặn sai
      const closes20 = d.slice(-20).map((k) => k.c);
      const ma20 = closes20.length >= 20 ? closes20.reduce((s, x) => s + x, 0) / 20 : NaN;
      const isTrendUp = breadth !== null && breadth >= breadthMin && regime === "RISK_ON" && Number.isFinite(ma20) && lastClose > ma20;
      if (isTrendUp) {
        return { ...base, ok: true, reason: `trend, no range — breadth ${breadth}% + RISK_ON + close > MA20 ${interval} (không bắt trend phải có range)`, trigger, range: null, breadth, regime, upthrust, suggestedStopPct: null, failOpen: false };
      }
      return { ...base, ok: false, reason: `không có trading range hợp lệ (width ${wyTfScale(interval).rangeMin}–60%, drift ≤${wyTfScale(interval).driftMax}%, test ≥1 mặt mỗi biên trong ${pval("WY_RANGE_LOOKBACK", WY_RANGE_LOOKBACK)} nến ${interval})`, trigger, range: null, breadth, regime, upthrust, suggestedStopPct: null, failOpen: false };
    }
    if (trigger === "none") {
      return { ...base, ok: false, reason: `range hợp lệ nhưng chưa có trigger Spring/SOS ở 5 nến ${interval} cuối`, trigger, range: tr, breadth, regime, upthrust, suggestedStopPct, failOpen: false };
    }
    if (regime === "RISK_OFF") {
      // v0.3.44: MỞ Spring ở RISK_OFF — Spring là bắt đáy mean-reversion, khác SOS breakout.
      // SOS ở RISK_OFF đã verify thua (-1.77%/28.6%) nên vẫn chặn. Spring cho qua, stake 1/2.
      // Breadth 0% hiện tại (BTC 60329 < MA20 70172) vẫn cho Spring qua — đây là ý user: mở Spring.
      if (trigger === "spring") {
        return { ...base, ok: true, reason: `Wyckoff SPRING pass ở RISK_OFF — breadth ${breadth}% < ${breadthMin}% nhưng Spring là bắt đáy, cho qua với stake 1/2 (v0.3.44)`, trigger, range: tr, breadth, regime, upthrust, suggestedStopPct, failOpen: false };
      }
      return { ...base, ok: false, reason: `trigger ${trigger} nhưng regime RISK_OFF (breadth ${breadth}% < ${breadthMin}% trên MA20) — SOS ở RISK_OFF bị chặn, chỉ Spring được mở (v0.3.44)`, trigger, range: tr, breadth, regime, upthrust, suggestedStopPct, failOpen: false };
    }
    return {
      ...base,
      ok: true,
      reason: `Wyckoff ${trigger.toUpperCase()} pass — range ${tr.widthPct.toFixed(2)}% width · drift ${tr.driftPct.toFixed(2)}% · quality ${tr.quality.toFixed(2)}${breadth !== null ? ` · breadth ${breadth}%` : ""}`,
      trigger,
      range: tr,
      breadth,
      regime,
      upthrust,
      suggestedStopPct,
      failOpen: false,
    };
  } catch (e) {
    return { ...base, ok: true, reason: `fail-open: ${e instanceof Error ? e.message : "wyckoff data error"}`, trigger: "none", range: null, breadth: null, regime: "unknown", upthrust: false, suggestedStopPct: null, failOpen: true };
  }
}

const fmt = (x: number): string => (x >= 1000 ? x.toFixed(2) : x >= 1 ? x.toFixed(2) : x.toPrecision(4));