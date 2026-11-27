// ─── Test — scan-state persist/load (hết "No scan data yet" sau restart) ─────
// Chạy: DATA_DIR=/tmp/elliott-test-ss bun run scripts/test-scanstate.ts
//
// Env PHẢI đặt trước khi bun khởi động: scan-state → data-dir đọc DATA_DIR lúc
// import, mà static import hoisting chạy trước mọi dòng code — env qua command
// line là cách duy nhất sạch (đ lesson từ test-train-lessons).

import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const DIR = "/tmp/elliott-test-ss";
const FILE = `${DIR}/scan-state.json`;
rmSync(DIR, { recursive: true, force: true });

process.env.DATA_DIR = DIR; // đặt TRƯỚC dynamic import — data-dir đọc DATA_DIR lúc module init
const { loadScanState, saveScanState } = await import("../src/lib/scan-state");

console.log("\n[4] scan-state — roundtrip qua file, filter row hỏng");
check("file chưa có → null hết", loadScanState().scan === null && loadScanState().universe === null);

const scanRow = { symbol: "BTCUSDT", interval: "1h", auc: 0.62, score: 41.5, acc: 60, prob: 0.6 };
saveScanState({ scan: { rows: [scanRow as never], at: 1234 } });
const st = loadScanState();
check("scan roundtrip", st.scan?.rows.length === 1 && st.scan?.at === 1234);

saveScanState({
  universe: { rows: [{ symbol: "ETHUSDT", atrPct: 3.2, trend: 0.4, ret24h: 0, ret10d: 0, score: 0.6 }] as never, at: 5678 },
});
const st2 = loadScanState();
check("universe roundtrip mà không mất scan", st2.universe?.at === 5678 && st2.scan?.at === 1234);

saveScanState({ scan: { rows: [null, "junk", 42] as never, at: 99 } });
check("row rác bị lọc → scan thành null", loadScanState().scan === null);

// mô phỏng boot: file cũ trên đĩa vẫn load lại được
mkdirSync(DIR, { recursive: true });
writeFileSync(FILE, JSON.stringify({ scan: { rows: [scanRow], at: 777 } }));
check("boot lại vẫn còn snapshot", loadScanState().scan?.at === 777);
check("file tồn tại trên đĩa", existsSync(FILE));

// file hỏng (JSON bậy) → defaults, không ném
writeFileSync(FILE, "{không phải json");
check("file hỏng → null, không crash", loadScanState().scan === null);

rmSync(DIR, { recursive: true, force: true });
console.log(`\n═══ ${pass} pass · ${fail} fail ═══`);
process.exit(fail > 0 ? 1 : 0);
