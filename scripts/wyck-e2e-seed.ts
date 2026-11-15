// Seed engine.json cho E2E chế độ WYCKOFF EYE (0.2.70 — chỉ báo chính).
// Đặt wyckSeen["BTCUSDT|1h"] = "0" (không khớp mọi eventId thật) → nếu hiện
// tại combo đó có entry Wyckoff fresh (nến đóng cuối) thì engine boot sẽ vào
// lệnh thật theo cấu trúc range. Combo khác sẽ ARM im lặng lần đầu.
// Run: DATA_DIR=/tmp/wyck-e2e npx tsx scripts/wyck-e2e-seed.ts
import { mkdirSync, writeFileSync } from "fs";
import { DEFAULT_SETTINGS } from "../src/lib/types";

const dir = process.env.DATA_DIR ?? "/tmp/wyck-e2e";
mkdirSync(dir, { recursive: true });
const seed = {
  cfg: {
    on: true,
    strategy: "wyckoff",
    capital: 1000,
    riskPct: 25,
    tpMode: "manual",
    slPct: 1,
    tpPct: 1.5,
    cycleMin: 5,
    runTf: ["15m", "1h", "4h"],
    broadcast: false,
    statHourly: false,
    statDaily: false,
  },
  settings: DEFAULT_SETTINGS,
  pairs: [],
  leverage: 1,
  syncedAt: Date.now(),
  nextCycleAt: 1, // due ngay boot tick
  warned: { id: "", tp: false, sl: false },
  dca: { id: "", count: 0, stake0: 0, prices: [] },
  llmLast: null,
  utSeen: {},
  utPending: {},
  wyckSeen: { "BTCUSDT|1h": "0" }, // "0" ≠ mọi eventId thật → entry fresh được trade
  wyckTrail: {},
};
writeFileSync(`${dir}/engine.json`, JSON.stringify(seed, null, 2) + "\n", "utf8");
console.log(`seeded ${dir}/engine.json — strategy wyckoff, wyckSeen BTCUSDT|1h ARM-forced`);
