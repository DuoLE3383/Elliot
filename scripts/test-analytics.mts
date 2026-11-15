// Smoke test analytics (0.2.97) — analyticsFromClosed + strategyAdvice.
// Chạy: npx tsx scripts/test-analytics.mts

import { analyticsFromClosed } from "../src/lib/autostate";
import { strategyAdvice } from "../src/components/strategy-cards";
import type { BookStats } from "../src/lib/arena";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra?: string): void => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const DAY = 86_400_000;
const base = Date.now() - 60 * DAY;
const t = (i: number): Date => new Date(base + i * DAY);

// chuỗi: +10, −5, +20, −5, −5 → W2 L3, expectancy +3, PF 30/15 = 2
const rows = [
  { symbol: "BTCUSDT", interval: "5m", side: "LONG", pnlPct: 10, exitKind: "tp", entryTime: t(0), exitTime: t(0, 120 as unknown as number) as Date, capitalAfter: 1100 },
  { symbol: "ETHUSDT", interval: "15m", side: "SHORT", pnlPct: -5, exitKind: "sl", entryTime: t(1), exitTime: t(1), capitalAfter: 1045 },
  { symbol: "BTCUSDT", interval: "5m", side: "LONG", pnlPct: 20, exitKind: "tp", entryTime: t(2), exitTime: t(2), capitalAfter: 1254 },
  { symbol: "SOLUSDT", interval: "1h", side: "LONG", pnlPct: -5, exitKind: "sl", entryTime: t(3), exitTime: t(3), capitalAfter: 1191 },
  { symbol: "SOLUSDT", interval: "1h", side: "SHORT", pnlPct: -5, exitKind: "manual", entryTime: t(4), exitTime: t(4), capitalAfter: 1132 },
];
// fix exitTime typing — dùng entryTime làm exitTime cho gọn
for (const r of rows) r.exitTime = r.entryTime;

const a = analyticsFromClosed(rows as never, 1000);
ok("expectancy = +3", a.expectancy === 3, String(a.expectancy));
ok("profitFactor = 2", a.profitFactor === 2, String(a.profitFactor));
ok("maxDD = (1254→1132) ≈ 9.73%", Math.abs(a.maxDrawdownPct - 9.73) < 0.01, String(a.maxDrawdownPct));
ok("streak hiện tại L2 (−5, −5 cuối)", a.streak.current === 2 && a.streak.currentKind === "loss", JSON.stringify(a.streak));
ok("maxWin streak = 1, maxLoss = 2", a.streak.maxWin === 1 && a.streak.maxLoss === 2, JSON.stringify(a.streak));
ok("byExitKind có tp/sl/manual", a.byExitKind.map((x) => x.kind).join(",") === "tp,sl,manual", JSON.stringify(a.byExitKind.map((x) => x.kind)));
// BTCUSDT & SOLUSDT đều 2 lệnh — sort ổn định → BTCUSDT đứng trước
ok("bySymbol top = BTCUSDT(2, net +30)", a.bySymbol[0]?.symbol === "BTCUSDT" && a.bySymbol[0]?.n === 2 && a.bySymbol[0]?.net === 30, JSON.stringify(a.bySymbol[0]));
ok("bySide LONG n=3 net +25", a.bySide.find((x) => x.side === "LONG")?.net === 25, JSON.stringify(a.bySide));
ok("equity có điểm xuất phát ví 1000", a.equity[0]?.capital === 1000 && a.equity.length === 6, String(a.equity.length));

// ── strategyAdvice ──
const mk = (nClosed: number, wr: number, netRoe: number): BookStats => ({
  nClosed,
  nOpen: 0,
  wins: 0,
  wr,
  netRoe,
  avgWin: 0,
  avgLoss: 0,
  payoff: 0,
  startCapital: null,
  finalCapital: null,
  bySide: [],
});
const adv1 = strategyAdvice([
  { id: "a", s: mk(10, 60, 25) },
  { id: "b", s: mk(30, 25, -18) },
  { id: "c", s: mk(2, 90, 50) }, // <3 lệnh → hold
]);
ok("A được đề xuất ON", adv1.find((x) => x.id === "a")?.action === "on");
ok("B được đề xuất OFF", adv1.find((x) => x.id === "b")?.action === "off");
ok("C <3 lệnh giữ hold", adv1.find((x) => x.id === "c")?.action === "hold");
// hai sổ đều mạnh → chỉ một ON (net cao nhất)
const adv2 = strategyAdvice([
  { id: "a", s: mk(10, 60, 25) },
  { id: "b", s: mk(30, 55, 60) },
  { id: "c", s: mk(5, 50, 3) },
]);
ok("chỉ 1 đề xuất ON (B net cao hơn)", adv2.filter((x) => x.action === "on").map((x) => x.id).join() === "b", JSON.stringify(adv2));

console.log(`\n═══ Analytics smoke: ${pass} pass / ${fail} fail ═══`);
if (fail > 0) process.exit(1);
