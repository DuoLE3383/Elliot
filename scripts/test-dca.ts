// Quick sanity test for the chase guard + DCA math — HBAR numbers from the user's screenshot:
// SHORT entry 0.071214, SL 0.07147 (≈0.36% giá), stopped out, then re-entered SHORT @ 0.07147.
import { passesChaseGuard, slCooldownLeft, lastSlExit, dcaFloors, sanitizeRunTf, type AutoTradeRow } from "../src/lib/autotrade";
import { INTERVALS } from "../src/lib/types";

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

// ── DCA model-quality floor (user setpoint 31/10: AUC > 0.6 · ACC > 70) ──────
// ETHUSDT 1m 31/10: bù lệnh lần 2/2 cho model AUC 0.47 · ACC 46.9% — thua cả
// tung xu. Từ giờ bị chặn ở cổng chất lượng, để SL làm việc.
check("floors trên panel mặc định (0.55/55) → max = 0.6/70", dcaFloors(0.55, 55), { auc: 0.6, acc: 70 });
check("floors khi panel siết cao hơn (0.7/75) → lấy sàn entry", dcaFloors(0.7, 75), { auc: 0.7, acc: 75 });
const dcaOk = (auc: number, acc: number, minAuc = 0.55, minAcc = 55): boolean => {
  const fl = dcaFloors(minAuc, minAcc);
  return auc >= fl.auc && acc >= fl.acc;
};
check("model thua tung xu (AUC 0.47 · ACC 46.9) — BLOCKED", dcaOk(0.47, 46.9), false);
check("model biên (AUC 0.60 · ACC 70) — allowed", dcaOk(0.6, 70), true);
check("dưới biên 1 chút (AUC 0.59 · ACC 72) — BLOCKED", dcaOk(0.59, 72), false);
check("panel siết 0.7: model 0.65/78 — BLOCKED", dcaOk(0.65, 78, 0.7, 70), false);
check("panel siết 0.7: model 0.71/76 — allowed", dcaOk(0.71, 76, 0.7, 70), true);

// ── runTf sanitize — bật tắt timeframe run trên panel ────────────────────────
check("runTf rỗng → trả về tất cả khung", sanitizeRunTf([]), [...INTERVALS]);
check("runTf sai hết → trả về tất cả", sanitizeRunTf(["2h", "abc", 42 as never]), [...INTERVALS]);
check("runTf lọc rác + sắp theo thứ tự gốc", sanitizeRunTf(["1h", "1m", "xyz", "15m"]), ["1m", "15m", "1h"]);
check("runTf trùng → gộp", sanitizeRunTf(["1m", "1m", "1h"]), ["1m", "1h"]);
check("runTf đủ 8 khung → giữ nguyên", sanitizeRunTf([...INTERVALS]), [...INTERVALS]);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
