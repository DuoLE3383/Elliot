// ─── Eye Wyckoff Phases [EyeAlgo] — CHỈ BÁO CHÍNH của dry run (0.2.70) ───────
//
// Port trung thành luật chỉ báo TradingView "Eye Wyckoff Phases [EyeAlgo]"
// (https://vn.tradingview.com/script/SftK6OS0-Eye-Wyckoff-Phases-EyeAlgo/)
// mà user yêu cầu dùng làm NGUỒN TÍN HIỆU CHÍNH cho engine auto:
//
//   • MÁY TRẠNG THÁI Wyckoff đầy đủ cho cả Accumulation lẫn Distribution:
//     SC/BC → AR → Phase B (ST lặp) → Spring/UTAD → Test → SOS/SOW →
//     LPS/LPSY → Markup/Markdown.
//   • DETECTION đúng luật EyeAlgo (xác nhận trên NẾN ĐÓNG, không repaint):
//     - Climax: đáy/đỉnh thấp/cao nhất trong `climaxLookback` nến + volume
//       z-score ≥ `climaxVolZ` + bar rộng ≥ `climaxBarAtr` × ATR + close dưới
//       (SC) / trên (BC) trend EMA.
//     - Range box: SC → AR, chiều cao giới hạn min/max (× ATR), re-anchor khi
//       climax mới phá phía climax (tối đa `maxReanchors` lần), hết hạn sau
//       `maxRangeLife` nến.
//     - ST/Test: chạm vùng đáy range với volume KHÔ (z-score thấp).
//     - Spring/UTAD: phá range ≤ `maxSpringDepthAtr` × ATR rồi ĐÓNG lại trong
//       `springCloseBars` nến — kèm Quality Score 0-100 (độ sâu, volume khô,
//       tốc độ đóng lại, vị trí close trong nến).
//     - SOS/SOW: đóng ngoài range với volume ≥ `sosVolRatio` × vol-MA và body
//       ≥ `sosBodyAtr` × ATR (effort thật, không phải noise).
//     - LPS/LPSY ENTRY: trong `lpsWindow` nến sau SOS, pullback về zone quanh
//       mức breakout, GIỮ midpoint của range, volume thấp hơn SOS (low-effort),
//       rồi nến đóng lại trên mức breakout với close nằm NỬA TRÊN nến.
//   • TRADE PLAN theo đúng mô tả chỉ báo:
//     - TP1 = 0.5 × chiều cao range trên breakout; TP2 = 1.0 × chiều cao range;
//     - TP3 = cause target (range height scale theo độ dài range, cap
//       `causeMaxMult`);
//     - SL theo `stopMode`: midpoint range / đáy LPS / cực trị Spring + buffer;
//     - sau TP1 stop về entry (breakeven) — engine thực hiện trong watcher;
//     - Setup Score 0-100 → grade A/B/C, lọc `minGrade`.
//
// Bản distribution chạy trên CÙNG bộ luật qua "T-space" (giá × −1, RSI đảo) —
// một máy trạng thái, hai chiều, giống cách port Pine v6 của wyckoff.ts.
//
// File THUẦN (không fs/db/fetch) — engine.ts dùng cho vòng live, test dùng để
// đo và đối chiếu trên nến thật.

import { atr, ema } from "./indicators";
import type { Kline } from "./types";

export type EyeDir = 1 | -1;
export type EyeStopMode = "mid" | "lps" | "spring";
export type EyeEntryMode = "lps" | "lps+spring";
export type EyeGrade = "A" | "B" | "C";

export interface EyeSettings {
  /** số nến lookback để xác nhận climax (đáy/đỉnh của cửa sổ) */
  climaxLookback: number;
  /** trend EMA — SC phải đóng dưới, BC trên EMA này */
  trendEmaLen: number;
  /** cửa sổ tính volume mean/std cho z-score */
  volZLen: number;
  /** climax volume z-score ≥ ngưỡng này mới là "bất thường" */
  climaxVolZ: number;
  /** climax bar phải rộng ≥ x × ATR */
  climaxBarAtr: number;
  /** rally SC→AR tối thiểu (× ATR) mới thành lập range */
  arMinAtr: number;
  /** số nến tối đa từ SC tới AR */
  maxBarsToAR: number;
  /** chiều cao range hợp lệ: min (× ATR) */
  rangeMinAtr: number;
  /** chiều cao range hợp lệ: max (× ATR) */
  rangeMaxAtr: number;
  /** tuổi thọ range tối đa (nến từ SC) */
  maxRangeLife: number;
  /** số lần re-anchor tối đa khi climax mới phá phía climax */
  maxReanchors: number;
  /** số nến Phase B (ST lặp) tối thiểu trước khi nhận SOS */
  minPhaseB: number;
  /** volume z-score dưới ngưỡng này tại ST/Test = volume khô */
  stVolZ: number;
  /** Spring/UTAD phá range tối đa (× ATR) */
  maxSpringDepthAtr: number;
  /** số nến được phép đóng lại trong range sau khi phá */
  springCloseBars: number;
  /** SOS volume ≥ ratio × vol-MA */
  sosVolRatio: number;
  /** SOS body ≥ x × ATR */
  sosBodyAtr: number;
  /** số nến sau SOS để tìm LPS/LPSY entry */
  lpsWindow: number;
  /** LPS zone quanh mức breakout (× ATR) */
  lpsZoneAtr: number;
  /** "lps" = entry cổ điển sau SOS; "lps+spring" = thêm entry sớm sau Test */
  entryMode: EyeEntryMode;
  /** SL: midpoint range / đáy LPS / cực trị Spring + buffer */
  stopMode: EyeStopMode;
  /** buffer thêm vào cực trị Spring khi stopMode = "spring" (× ATR) */
  springBufferAtr: number;
  /** TP1 = tp1Frac × chiều cao range trên breakout */
  tp1Frac: number;
  /** TP2 = tp2Frac × chiều cao range trên breakout */
  tp2Frac: number;
  /** cap bội số cause của TP3 */
  causeMaxMult: number;
  /** grade tối thiểu để engine trade setup */
  minGrade: EyeGrade;
  /** số nến tối đa giữ lệnh (hết hạn → đóng "time"); 0 = tắt */
  maxBarsInTrade: number;
}

/** Default calibrated cho crypto 15m/1h/4h — dùng đúng tinh thần EyeAlgo
 *  (tinh chỉnh fine sau khi dry run gốc chạy ổn). */
export const EYE_DEFAULTS: EyeSettings = {
  climaxLookback: 60,
  trendEmaLen: 200,
  volZLen: 30,
  climaxVolZ: 2.0,
  climaxBarAtr: 1.5,
  arMinAtr: 1.5,
  maxBarsToAR: 40,
  rangeMinAtr: 1.0,
  rangeMaxAtr: 8.0,
  maxRangeLife: 200,
  maxReanchors: 2,
  minPhaseB: 5,
  stVolZ: 0.8,
  maxSpringDepthAtr: 2.0,
  springCloseBars: 3,
  sosVolRatio: 1.2,
  sosBodyAtr: 0.5,
  lpsWindow: 12,
  lpsZoneAtr: 1.0,
  entryMode: "lps+spring",
  stopMode: "mid",
  springBufferAtr: 0.25,
  tp1Frac: 0.5,
  tp2Frac: 1.0,
  causeMaxMult: 3.0,
  minGrade: "C",
  maxBarsInTrade: 60,
};

export type EyeEventKind =
  | "SC" | "BC" | "AR" | "ST" | "Spring" | "UTAD" | "Test" | "SOS" | "SOW" | "LPS" | "LPSY" | "Markup" | "Markdown";

export interface EyeEvent {
  kind: EyeEventKind;
  dir: EyeDir;
  /** index nến stamped (climax/test/LPS) hoặc nến xác nhận (SOS/Markup) */
  bar: number;
  time: number;
  price: number;
}

export interface EyeEntry {
  /** +1 LONG (accumulation), −1 SHORT (distribution) */
  dir: EyeDir;
  /** "LPS" = entry cổ điển sau SOS; "SPRING_TEST" = entry sớm sau Test */
  kind: "LPS" | "SPRING_TEST";
  /** index nến XÁC NHẬN (đóng) — entry theo giá thị trường sau nến này */
  bar: number;
  /** open time nến xác nhận — khoá dedupe ổn định qua refetch */
  time: number;
  /** close của nến xác nhận — xấp xỉ giá vào lệnh */
  price: number;
  /** mức breakout (range top cho LONG, range bottom cho SHORT) */
  breakout: number;
  /** SL tuyệt đối theo stopMode */
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  /** |entry − SL| (giá) */
  risk: number;
  /** reward:risk của TP2 */
  rr2: number;
  /** Setup Score 0-100 theo mô tả chỉ báo */
  setupScore: number;
  grade: EyeGrade;
  /** id ổn định `${time}:${kind}:${dir}` — dedupe giữa các chu kỳ */
  eventId: string;
  /** "ACC Phase D (LPS)" kiểu dashboard */
  phaseTxt: string;
}

export interface EyeState {
  dir: EyeDir | 0;
  /** 0 idle · 1 SC/BC · 2 AR/range · 3 Phase B · 4 Spring/UTAD · 5 SOS/SOW · 6 Markup/Markdown */
  st: number;
  phaseTxt: string;
  rangeTop: number | null;
  rangeBottom: number | null;
  rangeBars: number;
  /** số lần re-anchor đã dùng */
  reanchors: number;
}

export interface EyeResult {
  state: EyeState;
  /** entry xác nhận TRÊN NẾN ĐÓNG CUỐI (lastClosed) — tín hiệu mới cho engine */
  entry: EyeEntry | null;
  entries: EyeEntry[];
  events: EyeEvent[];
  emaTrend: (number | null)[];
  lastClosed: number;
}

const GRADE_MIN: Record<EyeGrade, number> = { A: 80, B: 60, C: 40 };
export const gradeOf = (score: number): EyeGrade => (score >= 80 ? "A" : score >= 60 ? "B" : "C");
export const gradePass = (score: number, min: EyeGrade): boolean => score >= GRADE_MIN[min];

/** SMA + STD rolling cho volume z-score. */
function volStats(xs: number[], len: number): { mean: (number | null)[]; std: (number | null)[] } {
  const n = xs.length;
  const mean: (number | null)[] = new Array(n).fill(null);
  const std: (number | null)[] = new Array(n).fill(null);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sum += xs[i];
    sumSq += xs[i] * xs[i];
    if (i >= len) {
      const old = xs[i - len];
      sum -= old;
      sumSq -= old * old;
    }
    if (i >= len - 1) {
      const m = sum / len;
      const varr = Math.max(0, sumSq / len - m * m);
      mean[i] = m;
      std[i] = Math.sqrt(varr);
    }
  }
  return { mean, std };
}

// ─── trạng thái cấu trúc (T-space) ───────────────────────────────────────────
interface EyePat {
  d: EyeDir;
  st: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  // climax
  cBar: number; cLow: number; cVol: number; cVolZ: number; cWide: number;
  // range
  rHigh: number; rLow: number; arBar: number;
  life: number; // nến đã sống từ SC
  reanchors: number; barsToAR: number;
  /** đỉnh swing candidate chờ pullback xác nhận (−1 = chưa có) */
  arPend: number;
  // spring / utad
  spLow: number; spVol: number; spBar: number; spQ: number; spPendBar: number;
  testOk: boolean;
  /** max hiT (T-space) kể từ nến climax — AR phải là swing MỚI sau SC */
  hiSince: number;
  // sos
  sosBar: number; sosVol: number; sosBreak: number; sosSince: number;
  entryDone: boolean;
  evs: EyeEvent[];
}

const newPat = (d: EyeDir): EyePat => ({
  d, st: 0,
  cBar: -1, cLow: NaN, cVol: NaN, cVolZ: NaN, cWide: NaN,
  rHigh: NaN, rLow: NaN, arBar: -1,
  life: 0, reanchors: 0, barsToAR: 0, arPend: -1,
  spLow: NaN, spVol: NaN, spBar: -1, spQ: 0, spPendBar: -1,
  testOk: false,
  hiSince: -Infinity,
  sosBar: -1, sosVol: NaN, sosBreak: NaN, sosSince: 0,
  entryDone: false,
  evs: [],
});

function eyePhaseTxt(p: EyePat): string {
  const a = p.d === 1;
  const z =
    p.st === 1 ? `A (${a ? "SC" : "BC"})`
    : p.st === 2 ? `A (${a ? "AR" : "AR"})`
    : p.st === 3 ? `B (${a ? "ST" : "ST"})`
    : p.st === 4 ? `C (${a ? "Spring" : "UTAD"})`
    : p.st === 5 ? `D (${a ? "SOS" : "SOW"})`
    : `E (${a ? "Markup" : "Markdown"})`;
  return `${a ? "ACC" : "DIST"} ${z}`;
}

interface Ctx {
  i: number;
  cT: number; oT: number; hiT: number; loT: number;
  atrV: number;
  volV: number; volZ: number; volMAv: number | null;
  emaTv: number | null;
}

/** Phân tích Eye Wyckoff Phases trên toàn cửa sổ nến — máy bước trên NẾN ĐÓNG. */
export function eyeScan(
  klines: Kline[],
  settings: EyeSettings = EYE_DEFAULTS,
): EyeResult {
  const n = klines.length;
  const lastClosed = n - 2; // nến cuối vẫn đang hình thành
  const s = settings;
  const empty: EyeResult = {
    state: { dir: 0, st: 0, phaseTxt: "", rangeTop: null, rangeBottom: null, rangeBars: 0, reanchors: 0 },
    entry: null, entries: [], events: [], emaTrend: new Array(n).fill(null), lastClosed,
  };
  if (n < Math.max(s.trendEmaLen, s.climaxLookback, s.volZLen) + 10) return empty;

  const atrV = atr(klines, 14);
  const emaT = ema(klines, s.trendEmaLen);
  const { mean: volMean, std: volStd } = volStats(klines.map((k) => k.v), s.volZLen);

  const events: EyeEvent[] = [];
  const entries: EyeEntry[] = [];
  const pAcc = newPat(1);
  const pDist = newPat(-1);

  const reset = (p: EyePat): void => {
    p.evs = [];
    p.st = 0;
    p.cBar = -1; p.cLow = NaN; p.cVol = NaN; p.cVolZ = NaN; p.cWide = NaN;
    p.rHigh = NaN; p.rLow = NaN; p.arBar = -1;
    p.life = 0; p.reanchors = 0; p.barsToAR = 0; p.arPend = -1;
    p.spLow = NaN; p.spVol = NaN; p.spBar = -1; p.spQ = 0; p.spPendBar = -1;
    p.testOk = false;
    p.hiSince = -Infinity;
    p.sosBar = -1; p.sosVol = NaN; p.sosBreak = NaN; p.sosSince = 0;
    p.entryDone = false;
  };

  const ev = (p: EyePat, bar: number, priceT: number, kind: EyeEventKind): void => {
    const e: EyeEvent = { kind, dir: p.d, bar, time: klines[bar]?.t ?? 0, price: p.d * priceT };
    events.push(e);
    p.evs.push(e);
  };

  /** climax rule (T-space) — loT của cửa sổ + volume z + bar rộng + phía EMA.
   *  Mọi giá trị đã là T-space (dist đảo dấu sẵn trong ctx) nên MỘT luật cho
   *  cả hai chiều: climax = đáy T-space dưới trend EMA. */
  const isClimax = (p: EyePat, c: Ctx, loMin: number, hiMax: number): boolean => {
    void p; void hiMax;
    const extreme = c.loT <= loMin;
    const beyondEma = c.emaTv != null && c.cT < c.emaTv;
    const wide = c.atrV > 0 && c.hiT - c.loT >= s.climaxBarAtr * c.atrV;
    return extreme && c.volZ >= s.climaxVolZ && wide && beyondEma;
  };

  /** Spring/UTAD quality 0..1 — depth nhỏ + volume khô + đóng nhanh + close cao */
  const springQuality = (
    depthAtr: number, pokeVolZ: number, closeBars: number, closeLoc: number,
  ): number => {
    const depthScore = 1 - Math.min(depthAtr / s.maxSpringDepthAtr, 1);
    const volScore = 1 - Math.min(Math.max(pokeVolZ, 0) / s.climaxVolZ, 1);
    const speedScore = 1 - Math.min(closeBars / Math.max(s.springCloseBars, 1), 1);
    const locScore = Math.min(Math.max(closeLoc, 0), 1);
    return depthScore * 0.35 + volScore * 0.35 + speedScore * 0.15 + locScore * 0.15;
  };

  /** tạo EyeEntry từ cấu trúc — giá/T-space → real-space */
  const makeEntry = (p: EyePat, c: Ctx, kind: "LPS" | "SPRING_TEST"): EyeEntry | null => {
    const acc = p.d === 1;
    // SPRING_TEST entry xảy ra TRƯỚC SOS → breakout fallback về range top
    const breakoutT = Number.isFinite(p.sosBreak) ? p.sosBreak : p.rHigh;
    const height = p.rHigh - p.rLow;
    if (!Number.isFinite(breakoutT) || !(height > 0)) return null;
    const entryT = c.cT;
    // SL theo stopMode (T-space acc: dưới entry; dist mirror qua T-space)
    let slT: number;
    if (kind === "SPRING_TEST" || s.stopMode === "spring") {
      slT = (Number.isFinite(p.spLow) ? p.spLow : p.rLow) - s.springBufferAtr * c.atrV;
    } else if (s.stopMode === "mid") {
      slT = p.rLow + 0.5 * height;
    } else {
      // "lps" — đáy pullback quanh breakout / nửa dưới range
      slT = p.rLow + 0.25 * height;
    }
    const tp1T = breakoutT + s.tp1Frac * height;
    const tp2T = breakoutT + s.tp2Frac * height;
    const causeMult = Math.min(1 + p.life / 50, s.causeMaxMult);
    const tp3T = breakoutT + causeMult * height;
    const risk = Math.abs(entryT - slT);
    if (!(risk > 0)) return null;
    // entry phải còn TRƯỚC TP2 theo hướng lệnh (T-space luôn "long hướng") —
    // giá đã chạy quá mục tiêu thì setup hết R:R, không trade chase
    if (!(entryT < tp2T)) return null;
    const rr2 = Math.abs(tp2T - entryT) / risk;
    // ── setup score 0-100 — mọi thành phần dùng chỉ số CỦA NẾN SỰ KIỆN ──
    const climaxStrength =
      0.5 * Math.min(Math.max(p.cVolZ, 0) / (s.climaxVolZ * 1.5), 1) +
      0.5 * Math.min(Math.max(p.cWide, 0) / s.climaxBarAtr, 1);
    const sosRatio =
      Number.isFinite(p.sosVol) && volMean[p.sosBar] != null && (volMean[p.sosBar] as number) > 0
        ? p.sosVol / (volMean[p.sosBar] as number)
        : s.sosVolRatio;
    let score =
      climaxStrength * 25 +
      (Number.isFinite(p.spLow) ? p.spQ * 30 : 15) +
      (p.testOk ? 10 : 0) +
      20 * Math.min(Math.max(sosRatio / s.sosVolRatio, 0), 1.5) / 1.5 +
      10 * Math.min(p.life / 100, 1) +
      (kind === "LPS" && Number.isFinite(p.sosVol) && c.volV < p.sosVol * 0.7 ? 5 : 2);
    score = Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 50;
    const dirReal: EyeDir = p.d;
    const breakout = p.d * breakoutT;
    const toReal = (t: number): number => p.d * t;
    const entry: EyeEntry = {
      dir: dirReal,
      kind,
      bar: c.i,
      time: klines[c.i]?.t ?? 0,
      price: toReal(entryT),
      breakout,
      sl: toReal(slT),
      tp1: toReal(tp1T),
      tp2: toReal(tp2T),
      tp3: toReal(tp3T),
      risk: Math.abs(toReal(entryT) - toReal(slT)),
      rr2,
      setupScore: Math.round(score * 10) / 10,
      grade: gradeOf(score),
      eventId: `${klines[c.i]?.t ?? 0}:${kind}:${dirReal}`,
      phaseTxt: `${acc ? "ACC" : "DIST"} Phase ${kind === "SPRING_TEST" ? "C→D (Test entry)" : "D (LPS)"}`,
    };
    return entry;
  };

  /** MỘT nến đóng cho MỘT chiều — mirror hoàn toàn qua T-space. */
  const step = (p: EyePat, c: Ctx, loMin: number, hiMax: number): void => {
    // hết hạn / thất bại chung
    if (p.st > 0 && p.st < 6) {
      p.life += 1;
      if (p.life > s.maxRangeLife) {
        reset(p);
        return;
      }
    }
    const height = p.rHigh - p.rLow;

    switch (p.st) {
      case 0: {
        if (isClimax(p, c, loMin, hiMax)) {
          p.st = 1;
          p.cBar = c.i; p.cLow = c.loT; p.cVol = c.volV; p.cVolZ = c.volZ;
          p.cWide = c.atrV > 0 ? (c.hiT - c.loT) / c.atrV : 0;
          p.rLow = c.loT;
          p.life = 0; p.barsToAR = 0; p.hiSince = c.hiT;
          ev(p, c.i, c.loT, p.d === 1 ? "SC" : "BC");
        }
        return;
      }
      case 1: {
        // climax mới phá phía climax → re-anchor (tối đa maxReanchors)
        if (isClimax(p, c, loMin, hiMax) && c.loT < p.cLow) {
          if (p.reanchors < s.maxReanchors) {
            p.reanchors += 1;
            p.cBar = c.i; p.cLow = c.loT; p.cVol = c.volV; p.cVolZ = c.volZ;
            p.cWide = c.atrV > 0 ? (c.hiT - c.loT) / c.atrV : 0;
            p.rLow = c.loT; p.life = 0; p.barsToAR = 0; p.hiSince = c.hiT;
            ev(p, c.i, c.loT, p.d === 1 ? "SC" : "BC");
            return;
          }
          reset(p);
          return;
        }
        // đáy mới sâu quá mà không phải climax → SC cũ không phải đáy
        if (c.atrV > 0 && c.loT < p.cLow - s.maxSpringDepthAtr * c.atrV) {
          reset(p);
          return;
        }
        p.barsToAR += 1;
        if (p.barsToAR > s.maxBarsToAR) {
          reset(p);
          return;
        }
        // AR: đỉnh swing MỚI sau SC (rally đủ xa) + đã có nến ĐÓNG DƯỚI đỉnh
        // (pullback) — rally phải KẾT THÚC mới thành đỉnh range
        if (c.hiT > p.hiSince) {
          p.hiSince = c.hiT;
          p.arPend = c.i;
        }
        if (p.arPend >= 0 && p.arPend < c.i && c.cT < p.hiSince) {
          const h = p.hiSince - p.cLow;
          if (h >= s.rangeMinAtr * c.atrV && h <= s.rangeMaxAtr * c.atrV && p.hiSince - p.cLow >= s.arMinAtr * c.atrV) {
            p.st = 2;
            p.rHigh = p.hiSince;
            p.arBar = p.arPend;
            p.arPend = -1;
            ev(p, p.arBar, p.rHigh, "AR");
          } else {
            reset(p); // range không hợp lệ chiều cao
          }
        }
        return;
      }
      case 2: {
        if (c.hiT > p.hiSince) p.hiSince = c.hiT;
        // re-anchor climax trong range
        if (isClimax(p, c, loMin, hiMax) && c.loT < p.cLow) {
          if (p.reanchors < s.maxReanchors) {
            p.reanchors += 1;
            p.st = 1;
            p.cBar = c.i; p.cLow = c.loT; p.cVol = c.volV; p.cVolZ = c.volZ;
            p.cWide = c.atrV > 0 ? (c.hiT - c.loT) / c.atrV : 0;
            p.rLow = c.loT; p.rHigh = NaN; p.arBar = -1;
            p.life = 0; p.barsToAR = 0; p.arPend = -1; p.hiSince = c.hiT;
            ev(p, c.i, c.loT, p.d === 1 ? "SC" : "BC");
            return;
          }
          reset(p);
          return;
        }
        // Spring/UTAD: phá range rồi (sẽ) đóng lại
        if (c.loT < p.rLow) {
          const depth = p.rLow - c.loT;
          if (depth > s.maxSpringDepthAtr * c.atrV) {
            reset(p);
            return;
          }
          if (p.spPendBar < 0) p.spPendBar = c.i; // bắt đầu chờ đóng lại
          return;
        }
        // đang chờ Spring đóng lại trong springCloseBars nến
        if (p.spPendBar >= 0) {
          const since = c.i - p.spPendBar;
          if (since > s.springCloseBars) {
            p.spPendBar = -1; // không đóng lại → bỏ theo dõi (ST thông thường)
            return;
          }
          if (c.cT > p.rLow) {
            // SPRING (acc) / UTAD (dist) xác nhận — stamped tại nến poke
            const poke = p.spPendBar;
            const loPoke = klines[poke];
            const depthT = Math.abs(p.rLow - (p.d === 1 ? loPoke.l : -loPoke.h));
            const depthAtr = c.atrV > 0 ? depthT / c.atrV : s.maxSpringDepthAtr;
            const zv = (() => {
              const m = volMean[poke];
              const sd = volStd[poke];
              return m != null && sd != null && sd > 0 ? (klines[poke].v - m) / sd : 0;
            })();
            const closePoke = p.d === 1 ? loPoke.c : -loPoke.c;
            const hiPokeT = p.d === 1 ? loPoke.h : -loPoke.l;
            const loc = hiPokeT > loPoke.l ? (closePoke - (p.d === 1 ? loPoke.l : -loPoke.h)) / Math.max(hiPokeT - (p.d === 1 ? loPoke.l : -loPoke.h), 1e-9) : 0.5;
            p.spLow = p.d === 1 ? loPoke.l : -loPoke.h;
            p.spVol = klines[poke].v;
            p.spBar = poke;
            p.spQ = springQuality(depthAtr, zv, since, Math.min(Math.max(loc, 0), 1));
            p.st = 3;
            p.spPendBar = -1;
            ev(p, poke, p.spLow, p.d === 1 ? "Spring" : "UTAD");
          }
          return;
        }
        // ST thường: chạm vùng đáy với volume khô
        if (c.loT <= p.rLow + 0.25 * height && c.volZ < s.stVolZ) {
          ev(p, c.i, c.loT, "ST");
        }
        // SOS/SOW khi Phase B đủ lâu (số NẾN từ AR — Phase C có thể thiếu)
        if (
          c.cT > p.rHigh &&
          c.volV >= s.sosVolRatio * (c.volMAv ?? c.volV) &&
          Math.abs(c.cT - c.oT) >= s.sosBodyAtr * c.atrV &&
          p.arBar >= 0 && c.i - p.arBar >= s.minPhaseB
        ) {
          p.st = 5;
          p.sosBar = c.i; p.sosVol = c.volV; p.sosBreak = p.rHigh; p.sosSince = 0;
          ev(p, c.i, c.hiT, p.d === 1 ? "SOS" : "SOW");
        }
        return;
      }
      case 3: {
        // Spring đã có — chờ Test rồi SOS
        if (c.atrV > 0 && c.cT < p.spLow - 0.5 * c.atrV) {
          reset(p); // spring thất bại
          return;
        }
        // phá lại sâu hơn → cập nhật spring (double spring)
        if (c.loT < p.spLow) {
          const depth = p.rLow - c.loT;
          if (depth > s.maxSpringDepthAtr * c.atrV) {
            reset(p);
            return;
          }
          p.spLow = c.loT;
          p.spVol = c.volV;
          p.spBar = c.i;
          p.spQ = springQuality(depth / c.atrV, c.volZ, 1, 0.5);
          p.testOk = false;
          ev(p, c.i, c.loT, p.d === 1 ? "Spring" : "UTAD");
          return;
        }
        // Test: tái thử vùng spring với volume khô hơn
        if (c.loT <= p.spLow + 0.25 * height && c.volV < p.spVol) {
          p.testOk = true;
          ev(p, c.i, c.loT, "Test");
          // entry sớm SPRING_TEST (nếu bật)
          if (!p.entryDone && s.entryMode === "lps+spring") {
            const e = makeEntry(p, c, "SPRING_TEST");
            if (e && gradePass(e.setupScore, s.minGrade)) {
              p.entryDone = true;
              entries.push(e);
              ev(p, c.i, c.cT, "Markup");
            }
          }
        }
        // SOS
        if (
          c.cT > p.rHigh &&
          c.volV >= s.sosVolRatio * (c.volMAv ?? c.volV) &&
          Math.abs(c.cT - c.oT) >= s.sosBodyAtr * c.atrV &&
          p.arBar >= 0 && c.i - p.arBar >= s.minPhaseB
        ) {
          p.st = 5;
          p.sosBar = c.i; p.sosVol = c.volV; p.sosBreak = p.rHigh; p.sosSince = 0;
          ev(p, c.i, c.hiT, p.d === 1 ? "SOS" : "SOW");
        }
        return;
      }
      case 4: {
        // (không dùng — giữ cho tương thích switch)
        return;
      }
      case 5: {
        // SOS xong — tìm LPS/LPSY entry trong lpsWindow nến
        p.sosSince += 1;
        if (p.sosSince > s.lpsWindow) {
          p.st = 6; // hết cửa sổ — chỉ theo dõi markup, không entry
          ev(p, c.i, c.hiT, p.d === 1 ? "Markup" : "Markdown");
          return;
        }
        // pullback phá midpoint sau SOS → range yếu → bỏ
        if (c.loT < p.rLow + 0.5 * height - s.lpsZoneAtr * c.atrV) {
          reset(p);
          return;
        }
        // LPS: pullback về zone quanh breakout, volume thấp hơn SOS, giữ midpoint
        const inZone = c.loT <= p.sosBreak + 0.25 * height && c.loT >= p.rLow + 0.5 * height;
        const lowEffort = c.volV < p.sosVol;
        if (inZone && lowEffort && c.cT > p.sosBreak) {
          const denom = Math.max(c.hiT - c.loT, 1e-9);
          const upperHalf = (c.cT - c.loT) / denom >= 0.5;
          if (upperHalf && !p.entryDone) {
            const e = makeEntry(p, c, "LPS");
            if (e && gradePass(e.setupScore, s.minGrade)) {
              p.entryDone = true;
              p.st = 6;
              entries.push(e);
              ev(p, c.i, c.cT, p.d === 1 ? "LPS" : "LPSY");
              ev(p, c.i, c.hiT, p.d === 1 ? "Markup" : "Markdown");
              return;
            }
          }
        }
        return;
      }
      case 6: {
        // Markup/Markdown — Phase E kết thúc khi close quay lại cắt trend EMA
        if (c.emaTv != null && c.cT < c.emaTv) reset(p);
        return;
      }
    }
  };

  const warm = Math.max(s.trendEmaLen, s.climaxLookback, s.volZLen) + 2;
  for (let i = warm; i <= lastClosed; i++) {
    const k = klines[i];
    const m = volMean[i];
    const sd = volStd[i];
    const volZ = m != null && sd != null && sd > 0 ? (k.v - m) / sd : 0;
    const av = atrV[i];
    if (av == null) continue;

    // extremes cửa sổ climax (T-space acc: loMin = min low, hiMax = max high)
    let loMin = Infinity;
    let hiMax = -Infinity;
    for (let j = Math.max(0, i - s.climaxLookback); j <= i; j++) {
      if (klines[j].l < loMin) loMin = klines[j].l;
      if (klines[j].h > hiMax) hiMax = klines[j].h;
    }

    const volMAv = m;
    const accCtx: Ctx = {
      i,
      cT: k.c, oT: k.o, hiT: k.h, loT: k.l,
      atrV: av, volV: k.v, volZ, volMAv,
      emaTv: emaT[i],
    };
    const distCtx: Ctx = {
      i,
      cT: -k.c, oT: -k.o, hiT: -k.l, loT: -k.h,
      atrV: av, volV: k.v, volZ, volMAv,
      emaTv: emaT[i] != null ? -emaT[i]! : null,
    };
    step(pAcc, accCtx, loMin, hiMax);
    step(pDist, distCtx, -hiMax, -loMin);
  }

  // trạng thái hiện tại — cấu trúc sống (acc ưu tiên)
  const active: EyePat | null = pAcc.st > 0 ? pAcc : pDist.st > 0 ? pDist : null;
  const state: EyeState = active
    ? {
        dir: active.d,
        st: active.st,
        phaseTxt: eyePhaseTxt(active),
        rangeTop: active.d * active.rHigh,
        rangeBottom: active.d * active.rLow,
        rangeBars: active.life,
        reanchors: active.reanchors,
      }
    : { dir: 0, st: 0, phaseTxt: "", rangeTop: null, rangeBottom: null, rangeBars: 0, reanchors: 0 };

  // entry mới nhất — CHỈ tính nếu nến xác nhận là nến ĐÓNG CUỐI (tín hiệu mới)
  let entry: EyeEntry | null = null;
  for (const e of entries) {
    if (e.bar === lastClosed) {
      if (!entry || e.setupScore > entry.setupScore) entry = e;
    }
  }

  return { state, entry, entries, events, emaTrend: emaT, lastClosed };
}

/** Tuổi tối đa của entry (nến) — entry cũ hơn 2 nến không còn "mới". */
export const EYE_ENTRY_FRESH_BARS = 2;
