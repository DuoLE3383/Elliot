// test-vulcan-engine.mts — unit test quyết định live của sổ A (0.2.93)
import { decideVulcanLive, type VulcanOpenState } from "../src/lib/vulcan-engine";
import { VULCAN_DEFAULTS, type Candle } from "../src/lib/vulcan";

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
const r2 = (x: number): number => Math.round(x * 100) / 100;

/** 30 nến phẳng giá 100 vol 100 + 1 nến bứt phá (close 102, vol 200) */
function makeCandles(): Candle[] {
  const c: Candle[] = [];
  const t0 = Date.UTC(2026, 10, 1, 0, 0, 0);
  for (let i = 0; i < 30; i++) c.push({ t: t0 + i * 900_000, o: 100, h: 100.5, l: 99.5, c: 100, v: 100 });
  c.push({ t: t0 + 30 * 900_000, o: 100.2, h: 102.5, l: 101, c: 102, v: 200 });
  return c;
}

const entryT = Date.UTC(2026, 10, 1, 7, 45, 0); // mốc nến vào lệnh (giả lập)
const barT = Date.UTC(2026, 10, 1, 9, 15, 0); // nến đánh giá

console.log("== mở vị thế LONG từ breakout ==");
{
  const c = makeCandles();
  const d = decideVulcanLive(c, null, VULCAN_DEFAULTS);
  check("action = open", d.action.kind === "open");
  if (d.action.kind === "open") {
    check("side LONG", d.action.side === "LONG");
    check("entry = close nến cuối (102)", d.action.entry === 102);
    check("stop = entry − 2×ATR (dưới entry)", d.action.stopPrice < 102 && d.action.stopPrice > 98);
  }
}

console.log("== stop chạm (có gap xuống) ==");
{
  const c = makeCandles();
  c[c.length - 1] = { t: barT, o: 98.2, h: 98.6, l: 97.4, c: 97.8, v: 100 };
  const open: VulcanOpenState = { side: "LONG", entry: 100, entryTime: entryT, barsHeld: 5, stopPrice: 98, peak: 100.5, trailArmed: false };
  const d = decideVulcanLive(c, open, VULCAN_DEFAULTS);
  check("action = close/sl", d.action.kind === "close" && d.action.exitKind === "sl");
  if (d.action.kind === "close") check("khớp giá stop (gap: min(open,stop)=98)", d.action.price === 98);
}

console.log("== ROI ladder bậc 5% sau 60 phút ==");
{
  const c = makeCandles();
  c[c.length - 1] = { t: barT, o: 103, h: 105.8, l: 102.9, c: 105.5, v: 100 }; // move +5.5%
  const open: VulcanOpenState = { side: "LONG", entry: 100, entryTime: barT - 90 * 60_000, barsHeld: 6, stopPrice: 98, peak: 103, trailArmed: false };
  const d = decideVulcanLive(c, open, VULCAN_DEFAULTS);
  check("close roi_5pct", d.action.kind === "close" && d.action.exitKind === "roi_5pct");
  if (d.action.kind === "close") check("chốt ở close 105.5", d.action.price === 105.5);
}

console.log("== trailing siết stop khi lãi ≥ 2% ==");
{
  const c = makeCandles();
  c[c.length - 1] = { t: barT, o: 101.2, h: 103, l: 101, c: 102.5, v: 100 }; // move +2.5%
  const open: VulcanOpenState = { side: "LONG", entry: 100, entryTime: barT - 30 * 60_000, barsHeld: 1, stopPrice: 98, peak: 101.4, trailArmed: false };
  const d = decideVulcanLive(c, open, VULCAN_DEFAULTS);
  check("hold", d.action.kind === "hold");
  check("trailArmed bật", d.state?.trailArmed === true);
  check("stop siết theo ROI: peakRoi 15 (3% giá × ×5) → lock 14% ROI = +2.8% giá → 102.8", d.state ? r2(d.state.stopPrice) === 102.8 : false);
  check("peak = 103", d.state?.peak === 103);
}

console.log("== minHoldBars chặn rsi_exit sớm ==");
{
  const c = makeCandles();
  c[c.length - 1] = { t: barT, o: 101.2, h: 103, l: 101, c: 102.5, v: 100 }; // RSI ~100 > 70
  const open1: VulcanOpenState = { side: "LONG", entry: 100, entryTime: barT - 15 * 60_000, barsHeld: 1, stopPrice: 98, peak: 101.4, trailArmed: false };
  const open2: VulcanOpenState = { ...open1, barsHeld: 2, entryTime: barT - 30 * 60_000 };
  const d1 = decideVulcanLive(c, open1, VULCAN_DEFAULTS);
  const d2 = decideVulcanLive(c, open2, VULCAN_DEFAULTS);
  check("barsHeld=1 → vẫn hold (RSI>70 bị minHoldBars chặn)", d1.action.kind === "hold");
  check("barsHeld=2 → rsi_exit", d2.action.kind === "close" && d2.action.exitKind === "rsi_exit");
}

console.log("== SHORT: stop khi giá bật lên ==");
{
  const c = makeCandles();
  // nến cuối tạo SHORT breakout: close 98 < donLower 99.5, vol spike
  c[c.length - 1] = { t: barT, o: 99.8, h: 100.2, l: 97.5, c: 98, v: 200 };
  const d = decideVulcanLive(c, null, VULCAN_DEFAULTS);
  check("open SHORT", d.action.kind === "open" && d.action.side === "SHORT");
  if (d.action.kind === "open") check("stop TRÊN entry", d.action.stopPrice > d.action.entry);
  const c2 = makeCandles();
  c2[c2.length - 1] = { t: barT, o: 101.8, h: 102.4, l: 101.6, c: 102.2, v: 100 }; // bật quá stop
  const open: VulcanOpenState = { side: "SHORT", entry: 100, entryTime: entryT, barsHeld: 4, stopPrice: 102, peak: 99.5, trailArmed: false };
  const d2 = decideVulcanLive(c2, open, VULCAN_DEFAULTS);
  check("close/sl khi bật", d2.action.kind === "close" && d2.action.exitKind === "sl");
  if (d2.action.kind === "close") check("khớp max(open,stop)=102", d2.action.price === 102);
}

console.log(`\nKẾT QUẢ: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
