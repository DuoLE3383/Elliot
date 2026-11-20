/**
 * AUDIT: Vulcan A vì sao 0 lệnh + Wyckoff C vì sao ngược Long không Short.
 * Chạy: npx tsx scripts/audit-vulcan-wyckoff.ts
 * Đọc output: mỗi symbol in ra bước kẹt đầu tiên, không in chung chung.
 */
import { decideVulcanLive, VULCAN_SYMBOLS } from "../src/lib/vulcan-engine";
import { wyckoffLongGate } from "../src/lib/wyckoff-gate";
import { fetchKlinesDirect } from "../src/lib/klines-direct";
import { VULCAN_DEFAULTS } from "../src/lib/params";

async function main() {
  console.log("=== VULCAN A — 5 symbol, 15m, Donchian ===");
  console.log("Symbols:", VULCAN_SYMBOLS.join(", "));
  console.log("Params:", JSON.stringify(VULCAN_DEFAULTS));
  for (const sym of VULCAN_SYMBOLS) {
    try {
      const kl = await fetchKlinesDirect(sym, "15m", 60);
      const candles = kl.map((k) => ({ o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, t: k.t }));
      const d = decideVulcanLive(candles, null, VULCAN_DEFAULTS as any);
      const last = candles[candles.length - 1];
      console.log(`\n${sym} last=${last.c} decision=${JSON.stringify(d)}`);
      // Donchian band tự tính để đối chiếu
      const highs = candles.slice(-20, -1).map((c) => c.h);
      const lows = candles.slice(-20, -1).map((c) => c.l);
      console.log(`  Donchian20 upper=${Math.max(...highs).toFixed(2)} lower=${Math.min(...lows).toFixed(2)} close=${last.c.toFixed(2)} breakoutLong=${last.c > Math.max(...highs)} breakoutShort=${last.c < Math.min(...lows)}`);
    } catch (e) {
      console.log(`\n${sym} FETCH FAIL: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log("\n=== WYCKOFF C — vì sao ngược Long không Short ===");
  console.log("Thiết kế: LONG-ONLY. Ngược Long = Distribution/Upthrust = ĐỨNG NGOÀI, không phải SHORT.");
  console.log("wyckoffLongGate() chỉ trả PASS/FAIL, không trả SHORT — muốn Short phải viết thêm nhánh Distribution-Short riêng.");
  for (const sym of ["BTCUSDT", "ETHUSDT", "SOLUSDT"]) {
    try {
      const v = await wyckoffLongGate(sym, VULCAN_SYMBOLS, "1d");
      console.log(`${sym} gate=${JSON.stringify(v)}`);
    } catch (e) {
      console.log(`${sym} GATE FAIL: ${e instanceof Error ? e.message : e}`);
    }
  }
}
main();
