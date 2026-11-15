// Seed engine.json cho E2E chế độ UT bản gốc (0.2.69).
// Tìm tín hiệu UT mới nhất của BTCUSDT 1h trên mock trend, đặt utSeen lùi 2
// nến → engine boot sẽ coi tín hiệu hiện tại là MỚI và vào lệnh thật.
// Run: KLINES_HOSTS=http://127.0.0.1:9998 npx tsx scripts/ut-e2e-seed.ts
import { mkdirSync, writeFileSync } from "fs";
import { fetchKlinesDirect } from "../src/lib/klines-direct";
import { signalsFrom } from "../src/lib/signals";
import { DEFAULT_SETTINGS } from "../src/lib/types";

async function main(): Promise<void> {
  const klines = await fetchKlinesDirect("BTCUSDT", "1h", 500);
  const { signals } = signalsFrom(klines, DEFAULT_SETTINGS.atrKey, DEFAULT_SETTINGS.atrPeriod, DEFAULT_SETTINGS.smaPeriod);
  const forming = klines.length - 1;
  const latest = signals.filter((s) => s.i < forming).at(-1);
  if (!latest) throw new Error("mock không có tín hiệu BTCUSDT 1h — không seed được");
  const dir = process.env.E2E_DIR ?? "/tmp/ut-e2e";
  mkdirSync(dir, { recursive: true });
  const seed = {
    cfg: {
      on: true,
      strategy: "ut",
      capital: 1000,
      riskPct: 25,
      tpMode: "manual",
      slPct: DEFAULT_SETTINGS.slPct,
      tpPct: DEFAULT_SETTINGS.tpPct,
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
    utSeen: { "BTCUSDT|1h": latest.t - 2 * 3_600_000 },
    utPending: {},
  };
  writeFileSync(`${dir}/engine.json`, JSON.stringify(seed, null, 2) + "\n", "utf8");
  console.log(`seeded ${dir}/engine.json — tín hiệu ${latest.dir} @ nến ${new Date(latest.t).toISOString()} · utSeen lùi 2h`);
}
void main().catch((e) => {
  console.error("seed lỗi:", e);
  process.exit(1);
});
