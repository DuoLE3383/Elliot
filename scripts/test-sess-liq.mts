// QA 0.2.69 — phiếu "liquidation" (radar squeeze) trong composite verdict.
// Trước 0.2.69 radar chỉ là dòng ⛓ thông báo (weight 0 trong điểm composite);
// giờ là phiếu thứ 10, w = SESS_LIQ_WEIGHT (mặc định 2.5 = phiếu đơn lớn
// nhất), dump → lean âm, pump → lean dương, calm → lean 0, thiếu radar → null.
import { sessionVerdict, type VerdictInputs } from "../src/lib/session-forecast.ts";
import { setOverride } from "../src/lib/params-store.ts";
import type { SqueezeReport } from "../src/lib/squeeze.ts";
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

const mk1h = (n: number, f: (i: number) => number, v = 100): Kline[] =>
  Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return { t: NOW - (n - 1 - i) * HOUR, o: c, h: c * 1.001, l: c * 0.999, c, v, tb: v / 2 } as Kline;
  });

const mkDaily = (n: number, upPer14: number): Kline[] =>
  Array.from({ length: n }, (_, i) => {
    const up = i % 14 < upPer14;
    const c = up ? 1010 : 990;
    return { t: NOW - (n - 1 - i) * DAY, o: 1000, h: Math.max(c, 1000), l: Math.min(c, 1000), c, v: 1000, tb: 500 } as Kline;
  });

const sessAll = (bullPct: number, driftPct: number, candles: number): SessionStat[] =>
  (["sydney", "tokyo", "london", "newyork"] as const).map((key) => ({ key, bullPct, driftPct, candles }));

const pulseOf = (fg: number, funding: number, longPct: number | null): MarketPulse =>
  ({
    fearGreed: { now: { value: fg, label: "Neutral", at: NOW }, prev: null, week: [] },
    global: null,
    derivatives: { symbol: "BTCUSDT", openInterest: null, longAccountPct: longPct, topLongPct: null, fundingRatePct: funding, at: NOW },
    at: NOW,
    sources: [],
  }) as unknown as MarketPulse;

/** SqueezeReport tổng hợp — chỉ risk + vài trường hiển thị là cần cho verdict. */
const sqOf = (
  score: number,
  lean: "dump" | "pump" | "calm",
  o: { ls?: number | null; tk?: number | null; oi4?: number | null; fund?: number | null } = {},
): SqueezeReport =>
  ({
    symbol: "BTCUSDT",
    ts: NOW,
    price: 100_000,
    priceChgPct: { h1: -1, h4: -4, h24: -8 },
    oiValueUsd: 1e10,
    oiChgPct: { h1: null, h4: o.oi4 === undefined ? -6 : o.oi4, h24: null },
    lsRatio: o.ls === undefined ? 2.4 : o.ls,
    takerBuySell: o.tk === undefined ? 0.6 : o.tk,
    fundingRatePct: o.fund === undefined ? 0.05 : o.fund,
    risk: { score, lean, label: "x", drivers: [] },
  }) as SqueezeReport;

/** bối cảnh BULL rõ (mọi phiếu khác dương) — thay đổi mỗi loại squeeze. */
const bullInp = (squeeze?: SqueezeReport | null): VerdictInputs => ({
  now: NOW,
  klines: mk1h(300, (i) => 100 * Math.pow(1.001, i)),
  sessStats: sessAll(70, 0.08, 200),
  whale: { net: 100, strongBuy: 0, strongSell: 0, n: 20, last: 0 },
  daily: mkDaily(400, 11),
  pulse: pulseOf(15, 0.01, 45),
  squeeze,
});

const liqFactor = (v: ReturnType<typeof sessionVerdict>) => v.factors.find((f) => f.key === "liquidation");

// 1) dump mạnh → phiếu âm đúng độ lớn, weight mặc định 2.5, text có bằng chứng
const dump = sessionVerdict(bullInp(sqOf(85, "dump")));
const fd = liqFactor(dump)!;
check("dump 85: lean = −0.85", fd.lean === -0.85);
check("dump 85: weight mặc định 2.5 (phiếu đơn lớn nhất)", fd.weight === 2.5);
check("dump 85: text đầy đủ LS/taker/OI/funding", /^radar 85\/100 DUMP — LS 2\.40 · taker 0\.60 · OI 4h -6\.00% · funding \+0\.05%\/8h$/.test(fd.text));
check("dump 85: đủ 10 factors", dump.factors.length === 10);

// 2) pump → lean dương
const pump = sessionVerdict(bullInp(sqOf(60, "pump")));
check("pump 60: lean = +0.6", liqFactor(pump)!.lean === 0.6);

// 3) calm → lean 0 (KHÔNG phải null — có dữ liệu, không có nhiên liệu)
const calm = sessionVerdict(bullInp(sqOf(20, "calm")));
check("calm 20: lean = 0 (không null)", liqFactor(calm)!.lean === 0);

// 4) thiếu radar (undefined và null) → lean null, vẫn đủ 10 factors
const none1 = sessionVerdict(bullInp(undefined));
const none2 = sessionVerdict(bullInp(null));
check("không truyền squeeze: lean null", liqFactor(none1)!.lean == null && liqFactor(none2)!.lean == null);
check("không truyền squeeze: text unavailable", liqFactor(none1)!.text === "squeeze radar unavailable");

// 5) hướng đi điểm composite: dump kéo xuống, pump đủ mạnh đẩy lên,
//    calm pha loãng. Lưu ý: đây là trung bình có trọng số — phiếu pump 0.6
//    trên đồng thuận bull 0.81 sẽ PHA LOÃNG (dưới trung bình), nên phải lấy
//    pump 90 (lean 0.9 > 0.81) mới thấy được chiều đẩy lên.
const base = sessionVerdict(bullInp(undefined));
const pump90 = sessionVerdict(bullInp(sqOf(90, "pump")));
check(`dump kéo score xuống (${base.score} → ${dump.score})`, dump.score < base.score);
check(`pump 90 đẩy score lên (${base.score} → ${pump90.score})`, pump90.score > base.score);
check(`calm pha loãng về neutral (${base.score} → ${calm.score})`, calm.score > 0 && calm.score < base.score);

// 6) weight chỉnh runtime qua pval (panel /ai) — 4 mạnh hơn 2.5, 0 = tắt
const r4 = setOverride("SESS_LIQ_WEIGHT", 4);
check("setOverride SESS_LIQ_WEIGHT=4 ok", r4.ok);
const dumpW4 = sessionVerdict(bullInp(sqOf(85, "dump")));
check("w=4: weight trên factor = 4", liqFactor(dumpW4)!.weight === 4);
check(`w=4 kéo xuống mạnh hơn w=2.5 (${dump.score} → ${dumpW4.score})`, dumpW4.score < dump.score);
const r0 = setOverride("SESS_LIQ_WEIGHT", 0);
check("setOverride SESS_LIQ_WEIGHT=0 ok", r0.ok);
const dumpW0 = sessionVerdict(bullInp(sqOf(85, "dump")));
check(`w=0 = tắt hẳn: score khớp không-radar (${dumpW0.score} vs ${base.score})`, dumpW0.score === base.score);
setOverride("SESS_LIQ_WEIGHT", null);
const dumpRestored = sessionVerdict(bullInp(sqOf(85, "dump")));
check("gỡ override: về lại 2.5", liqFactor(dumpRestored)!.weight === 2.5 && dumpRestored.score === dump.score);

// 7) text không có trường nào → không đuôi " — "
const bare = sessionVerdict(bullInp(sqOf(85, "dump", { ls: null, tk: null, oi4: null, fund: null })));
check("thiếu mọi trường hiển thị: text gọn 'radar 85/100 DUMP'", liqFactor(bare)!.text === "radar 85/100 DUMP");
check("thiếu mọi trường: lean vẫn −0.85", liqFactor(bare)!.lean === -0.85);

// 8) một phiếu radar không tự flip call: dump 85 trên bối cảnh bull rõ vẫn
//    còn dương — cần ≥2 phiếu khác cùng chiều mới qua band
check(`dump đơn độc KHÔNG flip BEAR: vẫn > 0 (${dump.score})`, dump.score > 0);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
