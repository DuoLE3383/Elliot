// ─── UT strategy mode (0.2.69) — test chiến thuật bản gốc ────────────────────
// Run: npx tsx scripts/test-ut-mode.ts
//
// Kiểm chứng rằng các helper engine dùng cho chế độ strategy="ut"
// (ut-strategy.ts) tái tạo ĐÚNG luật của papersFrom — bộ mô phỏng "mirrors the
// Pine strategy" đã chạy hiệu quả từ bản gốc:
//   1. utLevels đọc SL/TP từ EngineSettings (mặc định 6/3.2, Pine 1.5/3)
//   2. utFlipDecision: flip luôn khi ngược chiều, bỏ qua khi cùng hướng
//      (pyramiding 0), không trade tín hiệu đã xử lý (t ≤ seen)
//   3. utGateOk mirror gateOkAt: gate tắt → qua hết; SMA null không chặn
//   4. ĐỐI CHIẾU 1-1 trên nến thật: mô phỏng đúng thứ tự A/B/C của papersFrom
//      (pending → SL/TP intrabar → tín hiệu) nhưng đi QUA các helper của
//      ut-strategy.ts phải cho CÙNG danh sách lệnh — gate tắt lẫn gate bật.

import { fetchKlinesDirect } from "../src/lib/klines-direct";
import { signalsFrom } from "../src/lib/signals";
import { kpiFrom, papersFrom } from "../src/lib/papers";
import { DEFAULT_SETTINGS, type Kline, type Signal } from "../src/lib/types";
import {
  latestConfirmedSignal,
  utFlipDecision,
  utGateOk,
  utLevels,
  utReadoutOf,
  utSideOf,
} from "../src/lib/ut-strategy";

let failed = 0;
function check(cond: boolean, label: string): void {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} — ${label}`);
  if (!cond) failed += 1;
}

const sig = (i: number, t: number, dir: "BUY" | "SELL"): Signal => ({ i, t, dir, smaOk: true, price: 0 });

// ── 1 · utLevels — một nguồn SL/TP với trang chính ───────────────────────────
console.log("1 · utLevels");
const lvDef = utLevels(DEFAULT_SETTINGS);
check(lvDef.slPct === 6 && lvDef.tpPct === 3.2, "DEFAULT_SETTINGS → SL 6 / TP 3.2");
const lvPine = utLevels({ ...DEFAULT_SETTINGS, slPct: 1.5, tpPct: 3 });
check(lvPine.slPct === 1.5 && lvPine.tpPct === 3, "PRESET_PINE → SL 1.5 / TP 3 (bản gốc Pine)");

// ── 2 · utFlipDecision — flip luôn, cùng hướng bỏ qua ───────────────────────
console.log("2 · utFlipDecision");
check(utFlipDecision("LONG", null, 0).action === "none", "không tín hiệu → giữ lệnh");
check(utFlipDecision("LONG", sig(9, 100, "BUY"), 100).action === "none", "tín hiệu đã xử lý (t ≤ seen) → none");
const flipOut = utFlipDecision("LONG", sig(9, 200, "SELL"), 100);
check(flipOut.action === "flip" && flipOut.side === "SHORT", "LONG đang mở + SELL mới → flip sang SHORT (luôn, không gate)");
check(utFlipDecision("LONG", sig(9, 200, "BUY"), 100).action === "ignore", "cùng hướng → pyramiding 0, bỏ qua");
check(utFlipDecision("SHORT", sig(9, 200, "SELL"), 100).action === "ignore", "SHORT + SELL cùng hướng → bỏ qua");

// ── 3 · utGateOk — mirror gateOkAt ──────────────────────────────────────────
console.log("3 · utGateOk");
check(utGateOk("LONG", 105, 100, true) === true, "LONG close > SMA → qua");
check(utGateOk("LONG", 95, 100, true) === false, "LONG close < SMA → chặn");
check(utGateOk("SHORT", 95, 100, true) === true, "SHORT close < SMA → qua");
check(utGateOk("LONG", 95, null, true) === true, "SMA null (đầu cửa sổ) KHÔNG chặn");
check(utGateOk("LONG", 95, 100, false) === true, "smaFilter tắt → mọi lệnh qua");
check(utSideOf("BUY") === "LONG" && utSideOf("SELL") === "SHORT", "utSideOf BUY→LONG, SELL→SHORT");

// ── 4 · Đối chiếu live-flow ≡ papersFrom trên nến thật ──────────────────────
console.log("4 · Đối chiếu engine-flow vs papersFrom (nến thật BTCUSDT)");
async function main(): Promise<void> {
const klines: Kline[] = await fetchKlinesDirect("BTCUSDT", "1h", 500);
console.log(`  nến: ${klines.length} × 1h · ${new Date(klines[0].t).toISOString()} → ${new Date(klines[klines.length - 1].t).toISOString()}`);
const { signals, sma } = signalsFrom(klines, DEFAULT_SETTINGS.atrKey, DEFAULT_SETTINGS.atrPeriod, DEFAULT_SETTINGS.smaPeriod);
console.log(`  signalsFrom: ${signals.length} tín hiệu UT (a=${DEFAULT_SETTINGS.atrKey}, c=${DEFAULT_SETTINGS.atrPeriod}, SMA${DEFAULT_SETTINGS.smaPeriod})`);
check(signals.length > 0, "có tín hiệu UT trên cửa sổ 500 nến");

const forming = klines.length - 1;
const latest = latestConfirmedSignal(signals, forming);
check(latest != null && latest.i < forming, "latestConfirmedSignal trả tín hiệu trên nến ĐÃ ĐÓNG");
const ro = utReadoutOf("BTCUSDT", "1h", klines, signals, sma);
check(ro.key === "BTCUSDT|1h" && ro.formingTime === klines[forming].t, "utReadoutOf đúng key + formingTime");
check(ro.lastClose === klines[forming - 1].c, "utReadoutOf lastClose = giá đóng nến đã đóng cuối");

interface EntryRec {
  side: string;
  entryIndex: number;
}

/** Mô phỏng đúng thứ tự A/B/C của papersFrom NHƯNG đi qua các helper của
 *  ut-strategy.ts (utGateOk/utSideOf/utFlipDecision) — proxy của dòng live
 *  utEntryTick/utFlipTick. seen=0: engine coi như đã quan sát từ trước cửa
 *  sổ nên MỌI tín hiệu trong cửa sổ là "mới" — so khớp được với papers. */
function simulate(smaFilter: boolean): EntryRec[] {
  const entries: EntryRec[] = [];
  const formingIdx = klines.length - 1;
  let open: { side: "LONG" | "SHORT"; entry: number; sl: number; tp: number; entryIndex: number } | null = null;
  let pending: { side: "LONG" | "SHORT"; signalIndex: number } | null = null;
  let seen = 0;
  const enterAt = (side: "LONG" | "SHORT", index: number): void => {
    const price = klines[index].o;
    open = {
      side,
      entry: price,
      sl: side === "LONG" ? price * (1 - DEFAULT_SETTINGS.slPct / 100) : price * (1 + DEFAULT_SETTINGS.slPct / 100),
      tp: side === "LONG" ? price * (1 + DEFAULT_SETTINGS.tpPct / 100) : price * (1 - DEFAULT_SETTINGS.tpPct / 100),
      entryIndex: index,
    };
    entries.push({ side, entryIndex: index });
    pending = null;
  };
  for (let i = 1; i <= formingIdx; i++) {
    const kc = klines[i];
    // A. pending vào ở giá MỞ nến i khi close trước đó vượt gate (luật papers)
    if (pending && !open && i > pending.signalIndex) {
      if (utGateOk(pending.side, klines[i - 1].c, sma[i - 1] ?? null, smaFilter)) enterAt(pending.side, i);
    }
    // B. SL/TP intrabar (SL ưu tiên) — mirror mục B của papersFrom
    if (open && open.entryIndex <= i) {
      if (open.side === "LONG") {
        if (kc.l <= open.sl) open = null;
        else if (kc.h >= open.tp) open = null;
      } else {
        if (kc.h >= open.sl) open = null;
        else if (kc.l <= open.tp) open = null;
      }
    }
    // C. tín hiệu xác nhận lúc đóng nến i — bỏ nến đang hình thành
    const s = signals.find((x) => x.i === i);
    if (!s || i >= formingIdx) continue;
    if (s.t <= seen) continue;
    const prevSeen = seen;
    seen = s.t;
    const side = utSideOf(s.dir);
    if (open) {
      // flip-always qua helper — quyết định Y HỆT luồng live utFlipTick
      const d = utFlipDecision(open.side, s, prevSeen);
      if (d.action === "flip" && d.side) {
        open = null;
        enterAt(d.side, i + 1); // flip KHÔNG BAO GIỜ bị gate
      }
      // "ignore" — pyramiding 0
    } else if (pending && pending.side !== side) {
      pending = { side, signalIndex: i };
    } else if (pending) {
      pending = { ...pending, signalIndex: i };
    } else if (utGateOk(side, kc.c, sma[i] ?? null, smaFilter)) {
      enterAt(side, i + 1);
    } else {
      pending = { side, signalIndex: i };
    }
  }
  return entries;
}

function entriesOfPapers(smaFilter: boolean): EntryRec[] {
  const res = papersFrom(klines, signals, sma, "BTCUSDT", "1h", DEFAULT_SETTINGS.slPct, DEFAULT_SETTINGS.tpPct, DEFAULT_SETTINGS.leverage, smaFilter);
  return res.papers.map((p) => ({ side: p.side, entryIndex: p.entryIndex }));
}

// gate TẮT (mặc định bản gốc) — hai luồng phải cho CÙNG lệnh
const simOff = simulate(false);
const papOff = entriesOfPapers(false);
console.log(`  gate OFF: engine-flow ${simOff.length} lệnh · papersFrom ${papOff.length} lệnh`);
check(
  JSON.stringify(simOff) === JSON.stringify(papOff),
  `gate OFF — engine-flow ≡ papersFrom (${simOff.length} lệnh, cùng side + nến vào)`,
);

// gate BẬT — pending có thể giữ lệnh chờ gate nên hai luồng vẫn phải bằng nhau
const simOn = simulate(true);
const papOn = entriesOfPapers(true);
console.log(`  gate ON : engine-flow ${simOn.length} lệnh · papersFrom ${papOn.length} lệnh`);
check(JSON.stringify(simOn) === JSON.stringify(papOn), "gate ON — engine-flow ≡ papersFrom (kèm pending)");
check(simOn.length <= simOff.length, "gate ON không mở nhiều lệnh hơn gate OFF");

// KPI tham chiếu bản gốc trên dữ liệu thật (để báo cáo user)
const kpi = kpiFrom(papersFrom(klines, signals, sma, "BTCUSDT", "1h", DEFAULT_SETTINGS.slPct, DEFAULT_SETTINGS.tpPct, DEFAULT_SETTINGS.leverage, false).papers);
console.log(
  `  KPI bản gốc (BTC 1h, SL 6/TP 3.2, đòn 1): ${kpi.closed} đóng · WR ${kpi.winRate.toFixed(1)}% · net ${kpi.netPnl.toFixed(1)}% · TP ${kpi.tpCount}/SL ${kpi.slCount}/flip ${kpi.flipCount}`,
);

console.log(failed === 0 ? "\nKẾT QUẢ: TẤT CẢ PASS ✅" : `\nKẾT QUẢ: ${failed} test FAIL ❌`);
process.exit(failed === 0 ? 0 : 1);
}

void main().catch((e) => {
  console.error("test lỗi:", e);
  process.exit(1);
});
