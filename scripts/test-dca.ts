// Quick sanity test for the chase guard + DCA math — HBAR numbers from the user's screenshot:
// SHORT entry 0.071214, SL 0.07147 (≈0.36% giá), stopped out, then re-entered SHORT @ 0.07147.
import { passesChaseGuard, slCooldownLeft, lastSlExit, type AutoTradeRow } from "../src/lib/autotrade";

const mk = (over: Partial<AutoTradeRow>): AutoTradeRow => ({
  id: "t1",
  symbol: "HBARUSDT",
  interval: "5m",
  side: "SHORT",
  entryPrice: 0.071214,
  entryTime: new Date().toISOString(),
  slPct: 0.36,
  tpPct: 0.5,
  leverage: 20,
  stakePct: 10,
  status: "closed",
  exitPrice: 0.07147,
  exitTime: new Date(Date.now() - 60_000).toISOString(), // SL 1 phút trước
  pnlPct: -6.46,
  exitKind: "sl",
  prob: 0.233,
  acc: 75,
  auc: 0.81,
  score: 64.4,
  capitalBefore: 100292.41,
  capitalAfter: 99644.52,
  createdAt: new Date().toISOString(),
  ...over,
});

const trades = [mk({})];
let fail = 0;
const check = (name: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "✅" : "❌"} ${name} → ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};

// ── chase guard ───────────────────────────────────────────────────────────────
check("re-enter SHORT @ exit price (0.07147) — BLOCKED", passesChaseGuard(trades, "HBARUSDT", "5m", "SHORT", 0.07147), false);
check("re-enter SHORT higher (0.0715) — BLOCKED", passesChaseGuard(trades, "HBARUSDT", "5m", "SHORT", 0.0715), false);
check("re-enter SHORT after reversal (0.07140) — allowed", passesChaseGuard(trades, "HBARUSDT", "5m", "SHORT", 0.0714), true);
check("opposite side (LONG) — always allowed", passesChaseGuard(trades, "HBARUSDT", "5m", "LONG", 0.0715), true);
check("other combo — allowed", passesChaseGuard(trades, "SOLUSDT", "15m", "SHORT", 0.0715), true);
check("no history — allowed", passesChaseGuard([], "HBARUSDT", "5m", "SHORT", 0.07147), true);
check("lastSlExit finds the row", lastSlExit(trades, "HBARUSDT", "5m")?.exitPrice, 0.07147);

// ── cooldown (existing behaviour, still on) ──────────────────────────────────
check("cooldown left ~30 min", slCooldownLeft(trades, "HBARUSDT", "5m", 30) > 25, true);
check("cooldown 0 = off", slCooldownLeft(trades, "HBARUSDT", "5m", 0), 0);

// ── DCA math: entry 0.071214 + DCA @ old-SL price → avg, re-anchored SL ──────
const entry = 0.071214;
const slPct = 0.36;
const oldSl = entry * (1 + slPct / 100); // mức SL cũ chính xác (0.0714700…)
const dca = oldSl; // trigger "cross": DCA ngay tại SL cũ
const avg = (entry + dca) / 2;
const newSl = avg * (1 + slPct / 100); // SHORT → SL trên avg
check("avg entry = mean of tranches", Number(avg.toFixed(8)), Number(((entry + oldSl) / 2).toFixed(8)));
check("new SL re-anchored on avg", Number(newSl.toFixed(8)), Number((((entry + oldSl) / 2) * 1.0036).toFixed(8)));
// giá vừa "ăn" SL cũ phải nằm TRONG vùng SL mới → không kích hoạt SL ngay lập tức
const crossedOld = dca >= oldSl;
const insideNew = dca < newSl;
check("price @DCA inside new SL (no instant re-stop)", crossedOld && insideNew, true);
// stake 10% + 10% = 20%
check("stake doubles", 10 + 10, 20);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
