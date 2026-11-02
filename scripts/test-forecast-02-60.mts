// QA 0.2.60 — session forecast v2: composite verdict 9 yếu tố
import { sessionVerdict, type VerdictInputs } from "../src/lib/session-forecast.ts";
import { setOverride } from "../src/lib/params-store.ts";
import type { Kline } from "../src/lib/types.ts";
import type { SessionStat, WhaleDelta } from "../src/lib/market.ts";
import type { MarketPulse } from "../src/lib/market-pulse.ts";

let fail = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
};

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.now();

/** nến 1h: n nến kết thúc tại NOW; closes sinh bởi f(i) */
const mk1h = (n: number, f: (i: number) => number, v = 100): Kline[] =>
  Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return { t: NOW - (n - 1 - i) * HOUR, o: c, h: c * 1.001, l: c * 0.999, c, v, tb: v / 2 } as Kline;
  });

/**
 * nến 1d: up iff (i % 14) < upPer14.
 *  upPer14 = 7  → CHÍNH XÁC 50% cho MỖI thứ (mỗi thứ xuất hiện 2 lần/14 ngày, một lên một xuống)
 *  upPer14 = 11 → mọi thứ ≥ 50% lên (bull)
 *  upPer14 = 3  → mọi thứ ≤ 50% lên (bear)
 */
const mkDaily = (n: number, upPer14: number): Kline[] =>
  Array.from({ length: n }, (_, i) => {
    const up = i % 14 < upPer14;
    const c = up ? 1010 : 990;
    return { t: NOW - (n - 1 - i) * DAY, o: 1000, h: Math.max(c, 1000), l: Math.min(c, 1000), c, v: 1000, tb: 500 } as Kline;
  });

const sessAll = (bullPct: number, driftPct: number, candles: number): SessionStat[] =>
  (["sydney", "tokyo", "london", "newyork"] as const).map((key) => ({ key, bullPct, driftPct, candles }));

const whaleOf = (net: number): WhaleDelta => ({ net, strongBuy: 0, strongSell: 0, n: 20, last: 0 });

const pulseOf = (fg: number, funding: number, longPct: number | null): MarketPulse =>
  ({
    fearGreed: { now: { value: fg, label: fg < 25 ? "Extreme Fear" : fg > 75 ? "Extreme Greed" : "Neutral", at: NOW }, prev: null, week: [] },
    global: null,
    derivatives: { symbol: "BTCUSDT", openInterest: null, longAccountPct: longPct, topLongPct: null, fundingRatePct: funding, at: NOW },
    at: NOW,
    sources: [],
  }) as unknown as MarketPulse;

const inp = (o: {
  closes: (i: number) => number;
  bull: number;
  drift: number;
  whaleNet?: number;
  upPer14: number;
  fg: number;
  longPct: number | null;
  candles?: number;
}): VerdictInputs => ({
  now: NOW,
  klines: mk1h(300, o.closes),
  sessStats: sessAll(o.bull, o.drift, o.candles ?? 200),
  whale: whaleOf(o.whaleNet === undefined ? (o.drift >= 0 ? 100 : -100) : o.whaleNet),
  daily: mkDaily(400, o.upPer14),
  pulse: pulseOf(o.fg, 0.01, o.longPct),
});

// 1) BULL rõ — mọi yếu tố cùng hướng dương
const bullCase = inp({ closes: (i) => 100 * Math.pow(1.001, i), bull: 70, drift: 0.08, upPer14: 11, fg: 15, longPct: 45 });
const bull = sessionVerdict(bullCase);
check("bull: call = BULL", bull.call === "BULL");
check(`bull: score >= 30 (${bull.score})`, bull.score >= 30);
check("bull: 9 factors", bull.factors.length === 9);
check("bull: confidence = |score|", bull.confidence === Math.abs(bull.score));
const fBull = bull.factors.filter((f) => (f.lean ?? 0) > 0).length;
check(`bull: đa số yếu tố dương (${fBull})`, fBull >= 6);
check("bull: mỗi factor có text", bull.factors.every((f) => f.text.length > 0));
check("bull: band mặc định 25", bull.band === 25);
check("bull: targetSession có", bull.targetSession != null);

// 2) BEAR gương soi
const bear = sessionVerdict(
  inp({ closes: (i) => 100 * Math.pow(0.999, i), bull: 30, drift: -0.06, upPer14: 3, fg: 85, longPct: 75 }),
);
check("bear: call = BEAR", bear.call === "BEAR");
check(`bear: score <= -30 (${bear.score})`, bear.score <= -30);

// 3) NEUTRAL — phẳng, 50/50 mọi thứ
const flat = sessionVerdict(inp({ closes: () => 100, bull: 50, drift: 0, whaleNet: 0, upPer14: 7, fg: 50, longPct: 55 }));
check(`flat: call = NEUTRAL (${flat.score})`, flat.call === "NEUTRAL");
check("flat: |score| < band", Math.abs(flat.score) < flat.band);

// 4) mẫu mỏng → reliability giảm |lean|
const thin = sessionVerdict(inp({ closes: (i) => 100 * Math.pow(1.001, i), bull: 70, drift: 0.08, upPer14: 11, fg: 15, longPct: 45, candles: 5 }));
const fSessionThin = thin.factors.find((f) => f.key === "session")!;
const fSessionFat = bull.factors.find((f) => f.key === "session")!;
check("thin sample: lean giảm", Math.abs(fSessionThin.lean!) < Math.abs(fSessionFat.lean!));

// 5) band override qua pval — điểm trung bình đổi call theo ngưỡng
//    chỉ session factor khác 0: lean = clamp((62−50)/20)×rel = 0.6 → score ≈ 10
const midCase = inp({ closes: () => 100, bull: 62, drift: 0, whaleNet: 0, upPer14: 7, fg: 50, longPct: 55 });
const mid = sessionVerdict(midCase);
check(`mid: mặc định NEUTRAL (band 25, score ${mid.score})`, mid.call === "NEUTRAL");
const r = setOverride("SESS_CALL_BAND", 10);
check("setOverride band 10 ok", r.ok);
const mid2 = sessionVerdict(midCase);
check(`mid: band 10 → BULL (score ${mid2.score}, band ${mid2.band})`, mid2.call === "BULL" && mid2.band === 10);
setOverride("SESS_CALL_BAND", null);

// 6) daily rỗng → weekday/calendar null, verdict vẫn trả từ 7 yếu tố còn lại
const noDaily = sessionVerdict({ ...bullCase, daily: [] });
check("no daily: vẫn trả verdict", noDaily.call != null);
check("no daily: weekday+calendar null", noDaily.factors.filter((f) => f.lean == null).length >= 2);
check(`no daily: vẫn BULL (${noDaily.score})`, noDaily.call === "BULL");

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
