// ─── STRATEGY LAB — sinh NHIỀU ứng viên chiến lược + backtest A/B ────────────
//
// Lịch sử: suggestFrom() cũ là greedy top-1 — mỗi tầng (ATR coef → UT
// key×period → SMA gate) chỉ giữ 1 winner, ~21 ứng viên còn lại bị vứt im
// lặng nên không có A/B thật. Lab này giữ LẠI mọi ứng viên, backtest TẤT CẢ
// bằng đúng thuật toán engine (signalsFrom → papersFrom → kpiFrom, ROE tính
// theo leverage như lệnh giấy thật) trên klines thật, rồi lưu CẢ THẮNG LẪN
// THUA vào bảng StrategyVariant → bảng xếp hạng expectancy có so sánh được.
//
// Ứng viên gồm 2 nguồn:
//   1. GRID — quét tham số cứng quanh cfg hiện tại (baseline + 5 ATR coef +
//      12 UT combo + 4 SMA gate) — như suggestFrom cũ nhưng KHÔNG greedy.
//   2. FEATURE-DRIVEN — đọc feature importance của champion FinetuneRun
//      (34 yếu tố đang train: ret/rsi/atr/sma/ema/volZ/body/wick/whale/ut/
//      session/hour/dow/dom/qEnd/atrRank/bbwRank/donchian/wyckoff…), mỗi NHÓM
//      yếu tố sinh đúng 1 biến thể kèm giả thuyết tiếng Việt, gắn tên feature
//      gain cao nhất của nhóm → "chiến lược dựa theo yếu tố đang train".
//
// Chạy server-side (0.2.35 đã dọn compute khỏi trình duyệt). Auto-lab sau
// mỗi lần train dùng throttle 12h/combo để không spam Binance. Không import
// engine.ts (vòng lặp) — caller truyền cfg hiện tại vào.

import { db } from "./db";
import { atr } from "./indicators";
import { fetchKlinesDirectResolved } from "./klines-direct";
import { kpiFrom, papersFrom } from "./papers";
import { signalsFrom } from "./signals";
import { DEFAULT_SETTINGS, type Kline } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Không gian cấu hình một biến thể — đúng các tham số engine có thật. */
export interface LabConfig {
  slPct: number;
  tpPct: number;
  atrKey: number;
  atrPeriod: number;
  smaFilter: boolean;
  smaPeriod: number;
  leverage: number;
}

export interface LabMetrics {
  /** số lệnh giấy đã đóng trong cửa sổ backtest */
  trades: number;
  wins: number;
  /** %, kpiFrom — win = ROE > 0 (khớp định nghĩa mọi nơi) */
  winRate: number;
  /** tổng ROE% các lệnh đóng */
  netPnl: number;
  /** netPnl / trades — tiêu chí xếp hạng chính */
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  tpCount: number;
  slCount: number;
  flipCount: number;
  /** drawdown sâu nhất trên đường ROE cộng dồn (≤ 0) */
  maxDd: number;
}

export interface LabCandidate {
  name: string;
  /** giả thuyết tiếng Việt — dựa yếu tố nào, chờ điều gì */
  hypothesis: string;
  /** feature gain chính gắn với biến thể ("" = thuần grid/quét) */
  sourceFeature: string;
  /** true = mốc so sánh cfg đang chạy */
  baseline: boolean;
  config: LabConfig;
}

export interface LabScored {
  candidate: LabCandidate;
  metrics: LabMetrics;
  /** ms backtest riêng biến thể này */
  backtestMs: number;
}

export interface FeatureGain {
  name: string;
  gain: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

const configKey = (c: LabConfig): string =>
  [
    c.slPct,
    c.tpPct,
    c.atrKey,
    c.atrPeriod,
    c.smaFilter ? 1 : 0,
    c.smaFilter ? c.smaPeriod : 0,
    c.leverage,
  ].join("|");

/** ATR(14) của nến đóng cuối, tính % giá — dùng cho SL/TP theo ATR. */
export function atrNowPct(klines: Kline[]): number {
  const li = klines.length - 2; // nến đóng cuối (nến cuối là nến đang chạy)
  const close = klines[li]?.c ?? klines[klines.length - 1]?.c ?? 0;
  if (!close) return 1;
  const a = atr(klines, 14)[li] ?? close * 0.01;
  return (a / close) * 100;
}

/** cfg engine (object lớn, có thêm llmUrl…) → LabConfig, phòng hờ thiếu field. */
export function labCfgOf(c: unknown): LabConfig {
  const o = (c ?? {}) as Record<string, unknown>;
  const num = (k: string, fb: number): number => {
    const v = Number(o[k]);
    return Number.isFinite(v) && v > 0 ? v : fb;
  };
  return {
    slPct: num("slPct", DEFAULT_SETTINGS.slPct),
    tpPct: num("tpPct", DEFAULT_SETTINGS.tpPct),
    atrKey: num("atrKey", DEFAULT_SETTINGS.atrKey),
    atrPeriod: Math.round(num("atrPeriod", DEFAULT_SETTINGS.atrPeriod)),
    smaPeriod: Math.round(num("smaPeriod", DEFAULT_SETTINGS.smaPeriod)),
    leverage: num("leverage", DEFAULT_SETTINGS.leverage),
    smaFilter: o.smaFilter === true,
  };
}

export function parseImportance(s: string | null | undefined): FeatureGain[] {
  if (!s) return [];
  try {
    const arr = JSON.parse(s) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is FeatureGain => {
        if (typeof x !== "object" || x == null) return false;
        const o = x as Record<string, unknown>;
        return typeof o.name === "string" && typeof o.gain === "number";
      })
      .sort((a, b) => b.gain - a.gain);
  } catch {
    return [];
  }
}

// ─── Backtest — đúng thuật toán engine ────────────────────────────────────────

/** Chạy một cấu hình qua engine giấy thật: UT Bot → SMA gate → papers → KPI. */
export function backtestLab(klines: Kline[], cfg: LabConfig, symbol: string, interval: string): LabMetrics {
  const raw = signalsFrom(klines, cfg.atrKey, cfg.atrPeriod, cfg.smaPeriod);
  const signals = cfg.smaFilter ? raw.signals : raw.signals.map((s) => ({ ...s, smaOk: true }));
  const res = papersFrom(
    klines,
    signals,
    raw.sma,
    symbol,
    interval,
    cfg.slPct,
    cfg.tpPct,
    cfg.leverage,
    cfg.smaFilter,
  );
  const k = kpiFrom(res.papers);
  let eq = 0;
  let peak = 0;
  let maxDd = 0;
  let winSum = 0;
  let lossSum = 0;
  for (const p of res.papers) {
    if (p.status !== "closed") continue;
    const pnl = p.pnlPct ?? 0;
    eq += pnl;
    peak = Math.max(peak, eq);
    maxDd = Math.min(maxDd, eq - peak);
    if (pnl > 0) winSum += pnl;
    else if (pnl < 0) lossSum += pnl;
  }
  return {
    trades: k.closed,
    wins: k.wins,
    winRate: k.winRate,
    netPnl: k.netPnl,
    expectancy: k.closed ? k.netPnl / k.closed : 0,
    avgWin: k.wins ? winSum / k.wins : 0,
    avgLoss: k.losses ? lossSum / k.losses : 0,
    tpCount: k.tpCount,
    slCount: k.slCount,
    flipCount: k.flipCount,
    maxDd,
  };
}

// ─── Sinh ứng viên ────────────────────────────────────────────────────────────

/** GRID quanh cfg hiện tại — baseline + 5 ATR coef + 12 UT + 4 SMA gate.
 *  Khử trùng lặp ngay trong grid: coin ATR nhỏ (BTC 15m ~0,2%) nhiều coef khác
 *  nhau ra cùng SL/TP sau clamp/round — chỉ giữ ứng viên đầu tiên của mỗi config. */
export function gridLab(base: LabConfig, klines: Kline[]): LabCandidate[] {
  const out: LabCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: LabCandidate) => {
    const key = configKey(c.config);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  push({
    name: "Mốc so sánh",
    hypothesis: "Baseline — cfg engine đang chạy; mọi ứng viên chỉ đáng áp khi thắng rõ mốc này.",
    sourceFeature: "",
    baseline: true,
    config: { ...base },
  });
  const ap = atrNowPct(klines);
  // SL/TP theo ATR — multiplier tự tìm như suggestFrom cũ nhưng giữ lại cả 5
  for (const coef of [1, 1.5, 2, 2.5, 3]) {
    const slPct = round1(clamp(ap * coef, 0.3, 20));
    const tpPct = round1(clamp(slPct * 1.4, 0.4, 28));
    if (slPct === base.slPct && tpPct === base.tpPct) continue;
    push({
      name: `SL/TP ATR ×${coef}`,
      hypothesis: `SL = ATR hiện tại (${round2(ap)}%) × ${coef}, TP = 1,4×SL — đi rộng khi biến động lớn, gọn khi thị trường lặng.`,
      sourceFeature: "atrPct",
      baseline: false,
      config: { ...base, slPct, tpPct },
    });
  }
  // UT Bot key × period
  for (const key of [1, 1.5, 2, 3]) {
    for (const period of [7, 10, 14]) {
      if (key === base.atrKey && period === base.atrPeriod) continue;
      push({
        name: `UT ${key}·${period}`,
        hypothesis: `UT Bot key ${key} / period ${period} — đường dừng nhạy hơn (bắt đảo sớm, nhiều nhiễu) hoặc chậm hơn (ít lệnh, đi trọn xu hướng) so với cfg ${base.atrKey}·${base.atrPeriod}.`,
        sourceFeature: "utTrend",
        baseline: false,
        config: { ...base, atrKey: key, atrPeriod: period, smaFilter: false },
      });
    }
  }
  // SMA trend gate
  for (const period of [50, 100, 150, 200]) {
    if (base.smaFilter && period === base.smaPeriod) continue;
    push({
      name: `Gate SMA${period}`,
      hypothesis: `Bật cổng xu hướng SMA${period}: LONG chỉ khi giá trên SMA, SHORT chỉ khi dưới — bỏ ngược dòng, đổi lại vào trễ hơn.`,
      sourceFeature: "sma20",
      baseline: false,
      config: { ...base, smaFilter: true, smaPeriod: period },
    });
  }
  return out;
}

/**
 * FEATURE-DRIVEN — map nhóm yếu tố đang train → 1 biến thể có giả thuyết rõ.
 * Mỗi nhóm chỉ sinh khi champion importance có feature của nhóm; lead = feature
 * gain cao nhất của nhóm (champion run lưu sẵn 34 gain trong FinetuneRun).
 */
export function featureLab(importance: FeatureGain[], base: LabConfig, klines: Kline[]): LabCandidate[] {
  if (!importance.length) return [];
  const ap = atrNowPct(klines);
  const leadOf = (feats: string[]): string | null => {
    for (const f of importance) if (feats.includes(f.name)) return f.name;
    return null;
  };
  const seen = new Set<string>();
  const out: LabCandidate[] = [];
  const push = (lead: string | null, build: () => LabCandidate) => {
    if (!lead) return;
    const c = build();
    const key = configKey(c.config);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  // 1 · Động lượng (ret1/ret3/ret10/rsi14) → TP rộng 1,6×SL chạy theo đà
  const leadMomentum = leadOf(["ret1", "ret3", "ret10", "rsi14"]);
  push(leadMomentum, () => ({
    name: "Đà giá — TP rộng",
    hypothesis: `Model tin động lượng nhất (${leadMomentum} gain cao): TP nới lên 1,6×SL để chạy theo đà thay vì chốt sớm như 1,4×.`,
    sourceFeature: leadMomentum!,
    baseline: false,
    config: { ...base, tpPct: round1(clamp(base.slPct * 1.6, 0.4, 28)) },
  }));

  // 2 · Biến động (atrPct/atrRank/bbwRank/donchian) → SL/TP nới 2,5×ATR
  const leadVol = leadOf(["atrPct", "atrRank", "bbwRank", "donchian"]);
  push(leadVol, () => {
    const slPct = round1(clamp(ap * 2.5, 0.3, 20));
    return {
      name: "Biến động cao — đi rộng",
      hypothesis: `Nhóm biến động mạnh (${leadVol} gain cao): SL = ATR (${round2(ap)}%) × 2,5, TP = 1,4×SL — chịu va rộng để không bị quét nhiễu trước khi giá đi.`,
      sourceFeature: leadVol!,
      baseline: false,
      config: { ...base, slPct, tpPct: round1(clamp(slPct * 1.4, 0.4, 28)) },
    };
  });

  // 3 · UT Bot (utTrend/stopDist) → đường dừng nhạy key 1·7
  const leadUt = leadOf(["utTrend", "stopDist"]);
  push(leadUt, () => ({
    name: "UT nhạy 1·7",
    hypothesis: `UT/đường dừng là yếu tố dẫn (${leadUt} gain cao): hạ key về 1, period 7 — thoát sớm khi xu hướng micro đảo, đánh đổi nhiều lệnh hơn.`,
    sourceFeature: leadUt!,
    baseline: false,
    config: { ...base, atrKey: 1, atrPeriod: 7, smaFilter: false },
  }));

  // 4 · MA (sma20/sma100/ema50) → cổng SMA100
  const leadMa = leadOf(["sma20", "sma100", "ema50"]);
  push(leadMa, () => ({
    name: "MA dẫn — Gate SMA100",
    hypothesis: `Đường MA là tín hiệu chính (${leadMa} gain cao): bắt cổng SMA100 — LONG trên SMA, SHORT dưới SMA, lọc sạch giao dịch ngược cấu trúc.`,
    sourceFeature: leadMa!,
    baseline: false,
    config: { ...base, smaFilter: true, smaPeriod: 100 },
  }));

  // 5 · Khối lượng/cấu trúc nến (volZ/whale×3/body/wick) → chốt nhanh 1,2×SL
  const leadVol2 = leadOf(["volZ", "whaleVol", "whaleAbsorb", "whaleClv", "body", "wick"]);
  push(leadVol2, () => ({
    name: "Dòng tiền — chốt nhanh",
    hypothesis: `Khối lượng/nến là chìa khoá (${leadVol2} gain cao): whale thường đảo nhanh nên TP gọn 1,2×SL, ăn phần move chắc chắn rồi thoát.`,
    sourceFeature: leadVol2!,
    baseline: false,
    config: { ...base, tpPct: round1(clamp(base.slPct * 1.2, 0.4, 28)) },
  }));

  // 6 · Thời gian (session/hour/dow/dom/qEnd) → SL gọn + cổng SMA200
  const leadTime = leadOf([
    "sessSydney", "sessTokyo", "sessLondon", "sessNewyork", "sessOverlap", "sessAge",
    "hourSin", "hourCos", "dowSin", "dowCos", "domStart", "domEnd", "qEnd",
  ]);
  push(leadTime, () => {
    const slPct = round1(clamp(ap * 1, 0.3, 20));
    return {
      name: "Giờ vàng — SL gọn",
      hypothesis: `Thời điểm giao dịch quyết định (${leadTime} gain cao): SL = 1×ATR (${round2(slPct)}%) để vào đúng nhịp phiên mạnh, kèm cổng SMA200 lọc xu hướng lớn.`,
      sourceFeature: leadTime!,
      baseline: false,
      config: { ...base, slPct, tpPct: round1(clamp(slPct * 1.4, 0.4, 28)), smaFilter: true, smaPeriod: 200 },
    };
  });

  // 7 · Wyckoff (wy×6) → cấu trúc lớn: TP rộng 1,8×SL + cổng SMA100
  const leadWy = leadOf(["wyRangePos", "wyRangeW", "wyClimax", "wySpring", "wyEffort", "wyTrend"]);
  push(leadWy, () => ({
    name: "Wyckoff — chờ cấu trúc",
    hypothesis: `Giai đoạn Wyckoff dẫn đường (${leadWy} gain cao): TP nới 1,8×SL + cổng SMA100 — phase markup/markdown chạy dài, không chốt giữa chừng.`,
    sourceFeature: leadWy!,
    baseline: false,
    config: { ...base, tpPct: round1(clamp(base.slPct * 1.8, 0.4, 28)), smaFilter: true, smaPeriod: 100 },
  }));

  return out;
}

/** Grid + feature-driven, khử trùng lặp config, backtest hết, xếp theo expectancy. */
export function generateLab(
  klines: Kline[],
  base: LabConfig,
  importance: FeatureGain[],
  symbol: string,
  interval: string,
): LabScored[] {
  const candidates: LabCandidate[] = [];
  const seen = new Set<string>();
  for (const c of [...gridLab(base, klines), ...featureLab(importance, base, klines)]) {
    const key = configKey(c.config);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(c);
  }
  const scored: LabScored[] = candidates.map((candidate) => {
    const t0 = performance.now();
    const metrics = backtestLab(klines, candidate.config, symbol, interval);
    return { candidate, metrics, backtestMs: Math.round(performance.now() - t0) };
  });
  // baseline luôn nổi đầu khi hoà expectancy (mốc so sánh phải nhìn thấy)
  scored.sort((a, b) => {
    const d = b.metrics.expectancy - a.metrics.expectancy;
    return d !== 0 ? d : Number(b.candidate.baseline) - Number(a.candidate.baseline);
  });
  return scored;
}

// ─── Persist + auto ───────────────────────────────────────────────────────────

const KLINE_LIMIT_LAB = 500;

/**
 * Chạy lab cho một combo và LƯU kết quả: xoá các biến thể chưa áp dụng cũ của
 * combo, chèn bộ mới (baseline + grid + feature-driven, đã chấm). Trả số biến
 * thể lưu. Klines/cfg/importance truyền sẵn thì dùng luôn — thiếu tự nạp.
 */
export async function runStrategyLab(
  symbol: string,
  interval: string,
  opts?: {
    klines?: Kline[];
    base?: LabConfig;
    importance?: FeatureGain[];
  },
): Promise<number> {
  const klines =
    opts?.klines && opts.klines.length > 60
      ? opts.klines
      : (await fetchKlinesDirectResolved(symbol, interval, KLINE_LIMIT_LAB)).klines;
  const base = opts?.base ?? labCfgOf(null);
  let importance = opts?.importance;
  if (!importance) {
    const champ = await db.finetuneRun.findFirst({
      where: { symbol, interval },
      orderBy: [{ auc: "desc" }, { acc: "desc" }, { createdAt: "desc" }],
    });
    importance = parseImportance(champ?.importance);
  }
  const scored = generateLab(klines, base, importance ?? [], symbol, interval);
  // bộ cũ chưa áp dụng là nền A/B lỗi thời — thay toàn bộ; bản đã áp dụng giữ lại
  await db.strategyVariant.deleteMany({ where: { symbol, interval, applied: false } });
  const now = new Date();
  for (const s of scored) {
    await db.strategyVariant.create({
      data: {
        symbol,
        interval,
        name: s.candidate.name.slice(0, 80),
        hypothesis: s.candidate.hypothesis.slice(0, 400),
        sourceFeature: s.candidate.sourceFeature.slice(0, 40),
        config: JSON.stringify(s.candidate.config),
        baseline: s.candidate.baseline,
        scored: true,
        metrics: JSON.stringify({
          trades: s.metrics.trades,
          wins: s.metrics.wins,
          winRate: Math.round(s.metrics.winRate * 10) / 10,
          netPnl: Math.round(s.metrics.netPnl * 100) / 100,
          expectancy: Math.round(s.metrics.expectancy * 1000) / 1000,
          avgWin: Math.round(s.metrics.avgWin * 100) / 100,
          avgLoss: Math.round(s.metrics.avgLoss * 100) / 100,
          tpCount: s.metrics.tpCount,
          slCount: s.metrics.slCount,
          flipCount: s.metrics.flipCount,
          maxDd: Math.round(s.metrics.maxDd * 100) / 100,
        }),
        applied: false,
        createdAt: now,
        scoredAt: now,
      },
    });
  }
  return scored.length;
}

/** Auto-lab sau train — throttle 12h/combo, lỗi nuốt lặng (không ảnh hưởng train). */
export async function maybeAutoLab(symbol: string, interval: string, base?: LabConfig): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - 12 * 3_600_000);
    const recent = await db.strategyVariant.count({
      where: { symbol, interval, createdAt: { gte: cutoff } },
    });
    if (recent > 0) return false; // lab của combo còn tươi — không chạy lại
    await runStrategyLab(symbol, interval, { base });
    return true;
  } catch {
    return false; // lab là phụ — không bao giờ làm fail flow train
  }
}
