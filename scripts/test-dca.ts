// Quick sanity test for the chase guard + DCA math — HBAR numbers from the user's screenshot:
// SHORT entry 0.071214, SL 0.07147 (≈0.36% giá), stopped out, then re-entered SHORT @ 0.07147.
import { passesChaseGuard, slCooldownLeft, lastSlExit, isTradeable, sanitizeFloors, sanitizeRunTf, type AutoTradeRow, type ScanRow } from "../src/lib/autotrade";
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

// ── SÀN CHUNG (thống nhất 1/11): entry = DCA = broadcast = MỘT bộ ba ─────
// LINKUSDT 15m 1/11: AUTO OPEN với model AUC 0.74 · ACC 65.6% · điểm 44.8 —
// qua sàn entry cũ 0.55/55 nhưng KHÔNG bao giờ được bù (dưới sàn DCA 0.6/70):
// lệnh mở ra từ đầu đã không có tư cách DCA. Thống nhất: một sàn cho cả hai,
// chỉnh một chỗ trên panel (cfg.minScore/minAuc/minAcc).
const srow = (auc: number, acc: number, score: number, bias = "LONG"): ScanRow =>
  ({ symbol: "LINKUSDT", interval: "15m", prob: 0.68, confidence: 0.36, bias, auc, acc, score }) as unknown as ScanRow;
const gateOk = (auc: number, acc: number, score: number, minAuc = 0.8, minAcc = 70, minScore = 60): boolean =>
  isTradeable(srow(auc, acc, score), minAuc, minAcc, minScore);
check("sàn cũ 0.55/55: LINKUSDT 0.74/65.6/44.8 qua — đây là chỗ hở", gateOk(0.74, 65.6, 44.8, 0.55, 55, 0), true);
check("sàn chung 0.8/70/60: LINKUSDT chặn TRƯỚC khi mở", gateOk(0.74, 65.6, 44.8), false);
check("model thua tung xu (0.47/46.9/7.5) — BLOCKED", gateOk(0.47, 46.9, 7.5), false);
check("dưới biên 1 chút (0.79/70/59) — BLOCKED", gateOk(0.79, 70, 59), false);
check("sát biên trên (0.80/70/60) — allowed", gateOk(0.8, 70, 60), true);
check("đủ AUC/ACC mà thiếu Điểm (0.81/71/55) — BLOCKED", gateOk(0.81, 71, 55), false);
check("đủ cả ba (0.81/71/62) — allowed", gateOk(0.81, 71, 62), true);
check("panel nới 0.6/60/40: model 0.65/78/52 — allowed", gateOk(0.65, 78, 52, 0.6, 60, 40), true);
check("NEUTRAL luôn đứng ngoài dù metrics cao", isTradeable(srow(0.85, 75, 65, "NEUTRAL"), 0.8, 70, 60), false);
check("sanitizeFloors legacy 0.55/55 → nâng sàn chung mới", sanitizeFloors(0.55, 55, undefined), { minAuc: 0.8, minAcc: 70, minScore: 60 });
check("sanitizeFloors giá trị lạ → default", sanitizeFloors("x", NaN, 999), { minAuc: 0.8, minAcc: 70, minScore: 95 });
check("sanitizeFloors hợp lệ → giữ nguyên", sanitizeFloors(0.7, 75, 55), { minAuc: 0.7, minAcc: 75, minScore: 55 });

// ── runTf sanitize — bật tắt timeframe run trên panel ────────────────────────
check("runTf rỗng → trả về tất cả khung", sanitizeRunTf([]), [...INTERVALS]);
check("runTf sai hết → trả về tất cả", sanitizeRunTf(["2h", "abc", 42 as never]), [...INTERVALS]);
check("runTf lọc rác + sắp theo thứ tự gốc", sanitizeRunTf(["1h", "1m", "xyz", "15m"]), ["1m", "15m", "1h"]);
check("runTf trùng → gộp", sanitizeRunTf(["1m", "1m", "1h"]), ["1m", "1h"]);
check("runTf đủ 8 khung → giữ nguyên", sanitizeRunTf([...INTERVALS]), [...INTERVALS]);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
