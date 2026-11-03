// Phase-1 flip-learning test — verifies the new wiring WITHOUT a DB:
//   1. flipLessons renders as a DISTINCT block in setupPrompt (separate from
//      recent_lessons). The LLM sees flip history as its own evidence.
//   2. flipCooldownLeft mirrors slCooldownLeft — 0 disables, otherwise minutes
//      since the last exitKind="flip" on the same combo.
//   3. decidePatch raises flipCooldownMin when flip-expectancy is negative,
//      lowers it when flips are healthy, and leaves it alone when n is too small.
import { setupPrompt, type LlmSetup } from "../src/lib/llm";
import { flipCooldownLeft, type AutoTradeRow } from "../src/lib/autotrade";
import { decidePatch, type MethodStats } from "../src/lib/self-improve";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const baseSetup: LlmSetup = {
  symbol: "BTCUSDT",
  interval: "1h",
  side: "SHORT",
  prob: 0.31,
  confidence: 0.38,
  auc: 0.72,
  acc: 68.0,
  slPct: 1.2,
  tpPct: 2.4,
  leverage: 10,
  stakePct: 25,
  horizon: 6,
  samples: 288,
  score: 42,
  gatePassed: true,
};

console.log("\n═══ 1. flipLessons — block riêng trong prompt ═══");
{
  const entry = setupPrompt(baseSetup);
  check("review entry KHÔNG có flip_lessons block", !entry.includes("flip_lessons:"));
  check("review entry KHÔNG có dòng flip post-mortems", !entry.includes("THIS PAIR's own FLIP exits"));

  const flip = setupPrompt({
    ...baseSetup,
    lessons: ["[1h LONG tp +2.1% ROE · tag=good_entry] hold trend until EMA50 reclaim"],
    flipLessons: [
      "[1h LONG FLIP -3.4% ROE · tag=whipsaw] do not flip when noise > 0.6×sl on 1h BTC",
      "[1h SHORT FLIP -1.8% ROE · tag=late_signal] wait for candle close confirmation before flipping",
    ],
  });
  check("review flip CÓ flip_lessons block", flip.includes("flip_lessons"));
  check("flip_lessons tách khỏi recent_lessons", flip.includes("recent_lessons") && flip.includes("flip_lessons"));
  check("flip block nêu rõ đây là FLIP exits", flip.includes("THIS PAIR's own FLIP exits"));
  check("mỗi flip lesson nằm trên một dòng", flip.includes("- [1h LONG FLIP -3.4% ROE"));
  check("entry lesson vẫn còn trong flip review", flip.includes("[1h LONG tp +2.1% ROE"));
}

console.log("\n═══ 2. flipCooldownLeft — anti-churn ═══");
{
  const now = Date.now();
  const trades: AutoTradeRow[] = [
    {
      id: "t1",
      symbol: "BTCUSDT",
      interval: "1h",
      side: "LONG",
      entryPrice: 50000,
      entryTime: new Date(now - 120 * 60_000),
      exitPrice: 49500,
      exitTime: new Date(now - 60 * 60_000), // 60 min ago
      slPct: 1,
      tpPct: 2,
      leverage: 10,
      stakePct: 25,
      status: "closed",
      exitKind: "flip",
      pnlPct: -50,
      prob: 0.7,
      acc: 70,
      auc: 0.8,
      score: 50,
      capitalBefore: 1000,
      methodId: "m1",
      llmVerdict: "go",
      llmReason: null,
    } as AutoTradeRow,
  ];

  // cooldown 0 = off
  check("cooldown 0 → 0 phút chờ", flipCooldownLeft(trades, "BTCUSDT", "1h", 0, now) === 0);
  // 30 min cooldown, last flip 60 min ago → 0 left
  check("30ph cooldown, flip 60ph trước → 0", flipCooldownLeft(trades, "BTCUSDT", "1h", 30, now) === 0);
  // 90 min cooldown, last flip 60 min ago → 30 left
  const left = flipCooldownLeft(trades, "BTCUSDT", "1h", 90, now);
  check("90ph cooldown, flip 60ph trước → 30ph còn lại", left === 30, `got ${left}`);
  // khác combo → không ảnh hưởng
  check("khác symbol → 0", flipCooldownLeft(trades, "ETHUSDT", "1h", 90, now) === 0);
  check("khác interval → 0", flipCooldownLeft(trades, "BTCUSDT", "15m", 90, now) === 0);
  // không có flip trade → 0
  const noFlip: AutoTradeRow[] = [{ ...trades[0], exitKind: "sl" } as AutoTradeRow];
  check("exitKind=sl → 0 (chỉ đếm flip)", flipCooldownLeft(noFlip, "BTCUSDT", "1h", 90, now) === 0);
}

console.log("\n═══ 3. decidePatch — nắn flipCooldownMin theo flip-expectancy ═══");
{
  const cfg = {
    on: true,
    capital: 1000,
    riskPct: 25,
    tpMode: "atr" as const,
    slPct: 1,
    tpPct: 2,
    atrCoef: 1.5,
    cycleMin: 5,
    runTf: ["1h"],
    minAuc: 0.8,
    minAcc: 70,
    minScore: 60,
    cooldownMin: 30,
    dcaMax: 1,
    statHourly: true,
    statDaily: true,
    llmUrl: "http://127.0.0.1:8888",
    llmModel: "llama",
    llmTimeoutSec: 90,
    llmFailClosed: false,
    whaleFilter: true,
    broadcast: true,
    autoFlip: true,
    flipCooldownMin: 0,
    trailOn: false,
    trailAuto: true,
    trailActPct: 1,
    trailDistPct: 0.8,
  };

  // entry healthy, flips bleeding → raise flipCooldownMin 0→15
  const entryOk: MethodStats = {
    methodId: "m1",
    n: 30,
    wins: 18,
    winRate: 60,
    netRoe: 12,
    expectancy: 0.4,
    avgWin: 2,
    avgLoss: -1,
  };
  const flipsBad: MethodStats = {
    methodId: "__flip__",
    n: 10,
    wins: 3,
    winRate: 30,
    netRoe: -18,
    expectancy: -1.8,
    avgWin: 1,
    avgLoss: -3,
  };
  const r1 = decidePatch(entryOk, cfg, flipsBad);
  check("flips thua → raise flipCooldownMin 0→15", r1.patch?.flipCooldownMin === 15, r1.note);
  check("note nhắc flip churn bleed", r1.note.includes("flip churn bleed"));

  // flips still bad, already at 15 → raise to 30
  const r2 = decidePatch(entryOk, { ...cfg, flipCooldownMin: 15 }, flipsBad);
  check("flips vẫn thua → 15→30", r2.patch?.flipCooldownMin === 30, r2.note);

  // flips healthy → lower 30→15
  const flipsGood: MethodStats = { ...flipsBad, n: 12, wins: 8, winRate: 67, netRoe: 6, expectancy: 0.5 };
  const r3 = decidePatch(entryOk, { ...cfg, flipCooldownMin: 30 }, flipsGood);
  check("flips khỏe → 30→15", r3.patch?.flipCooldownMin === 15, r3.note);

  // flips healthy at 0 → stay 0 (no further to go)
  const r4 = decidePatch(entryOk, { ...cfg, flipCooldownMin: 0 }, flipsGood);
  check("flips khỏe ở 0 → giữ 0 (không âm)", r4.patch?.flipCooldownMin === undefined, r4.note);

  // not enough flips → leave flipCooldownMin alone
  const fewFlips: MethodStats = { ...flipsBad, n: 5 };
  const r5 = decidePatch(entryOk, cfg, fewFlips);
  check("ít flip (<8) → không đụng flipCooldownMin", r5.patch?.flipCooldownMin === undefined, r5.note);

  // flips null → no flip tuning, entry tuning still works
  const r6 = decidePatch(entryOk, cfg, null);
  check("flipStats=null → không crash, entry logic vẫn chạy", r6 !== undefined);
}

console.log(`\n═══ KẾT QUẢ: ${pass} PASS · ${fail} FAIL ═══`);
if (fail > 0) process.exit(1);
