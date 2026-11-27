// test-arena.mts — unit test thống kê arena (thuần, không DB)
import { statsFromRois } from "../src/lib/arena";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.error(`FAIL  ${name}`);
  }
}

const rows = [
  { side: "LONG", roi: 10, capitalBefore: 1000, capitalAfter: 1010 },
  { side: "LONG", roi: -20, capitalBefore: 1010, capitalAfter: 990 },
  { side: "SHORT", roi: 5, capitalBefore: 990, capitalAfter: 995 },
  { side: "SHORT", roi: -10, capitalBefore: 995, capitalAfter: 985 },
  { side: "LONG", roi: 30, capitalBefore: 985, capitalAfter: 1015 },
];

const s = statsFromRois(rows);
console.log("== statsFromRois ==");
check("5 lệnh đóng", s.nClosed === 5);
check("3 thắng → WR 60%", s.wins === 3 && s.wr === 60);
check("net ROI = 15", s.netRoi === 15);
check("avgWin = (10+5+30)/3 = 15", s.avgWin === 15);
check("avgLoss = −15", s.avgLoss === -15);
check("payoff = 1.0", s.payoff === 1);
check("vốn đầu 1000 / cuối 1015", s.startCapital === 1000 && s.finalCapital === 1015);
check("LONG: 3 lệnh WR 66.7% net 20", s.bySide[0].n === 3 && s.bySide[0].wr === 66.7 && s.bySide[0].net === 20);
check("SHORT: 2 lệnh WR 50% net −5", s.bySide[1].n === 2 && s.bySide[1].wr === 50 && s.bySide[1].net === -5);

const empty = statsFromRois([]);
check("rỗng không nổ: nClosed 0, payoff 0", empty.nClosed === 0 && empty.payoff === 0 && empty.finalCapital === null);

console.log(`\nKẾT QUẢ: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
