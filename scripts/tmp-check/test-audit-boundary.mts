import { expectedPnlPctOf } from "../../src/lib/audit-book";
const cases = [
  { name: "SHORT thắng 20% giá lev5 (100→80) — kỳ vọng +99.5", row: { side: "SHORT", entryPrice: 100, exitPrice: 80, leverage: 5, exitKind: "tp" } },
  { name: "SHORT thua 25% giá lev5 (100→125) — kỳ vọng −100 (thanh lý)", row: { side: "SHORT", entryPrice: 100, exitPrice: 125, leverage: 5, exitKind: "liq" } },
  { name: "LONG thắng 20% giá lev5 (100→120) — kỳ vọng +99.5", row: { side: "LONG", entryPrice: 100, exitPrice: 120, leverage: 5, exitKind: "tp" } },
  { name: "LONG thua 20% giá lev5 (100→80) — kỳ vọng −100 (thanh lý)", row: { side: "LONG", entryPrice: 100, exitPrice: 80, leverage: 5, exitKind: "liq" } },
  { name: "SHORT thắng 10% giá lev10 (100→90) — kỳ vọng +99", row: { side: "SHORT", entryPrice: 100, exitPrice: 90, leverage: 10, exitKind: "tp" } },
  { name: "SHORT thua 12% giá lev10 (100→112) — kỳ vọng −100 (thanh lý)", row: { side: "SHORT", entryPrice: 100, exitPrice: 112, leverage: 10, exitKind: "liq" } },
];
for (const c of cases) console.log(`${expectedPnlPctOf(c.row as never)}   <- ${c.name}`);
