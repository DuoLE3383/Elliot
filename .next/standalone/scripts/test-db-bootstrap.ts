// ─── Test: DB self-healing schema bootstrap (src/lib/db.ts) ──────────────────
// Chạy với một DATABASE_URL trỏ tới file DB MỚI TUYỆT ĐỐI (thư mục cũng chưa
// có) — app phải tự mkdir + tự tạo bảng rồi mọi truy vấn chạy bình thường.
// Kịch bản thêm: DROP TABLE giữa chừng → P2021 → tự dựng lại + retry.
//
//   DATABASE_URL="file:/tmp/elliott-bootstrap-test/custom.db" \
//     bun run scripts/test-db-bootstrap.ts

import { db } from "@/lib/db";

let passed = 0;
const check = (cond: boolean, label: string): void => {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`ok: ${label}`);
};

const suggestionData = {
  symbol: "BTCUSDT",
  interval: "5m",
  bias: "LONG",
  prob: 0.6,
  confidence: 0.2,
  slPct: 1,
  tpPct: 1.5,
  atrKey: 2,
  atrPeriod: 10,
  smaFilter: true,
  smaPeriod: 200,
  acc: 55,
  auc: 0.56,
  horizonBars: 4,
  entryPrice: 100,
} as const;

async function main(): Promise<void> {
  // 1) DB file chưa tồn tại → lần truy vấn đầu tiên phải tự dựng schema
  const empty = await db.suggestion.findMany();
  check(Array.isArray(empty) && empty.length === 0, "fresh DB: first query bootstraps schema (findMany -> [])");

  // 2) Ghi được vào cả 3 bảng ứng dụng
  const s = await db.suggestion.create({ data: { ...suggestionData } });
  const f = await db.finetuneRun.create({
    data: { symbol: "BTCUSDT", interval: "5m", samples: 10, valSamples: 2, acc: 55, auc: 0.55, logloss: 0.69, trees: 120, horizon: 4, importance: "[]", params: "{}" },
  });
  const a = await db.autoTrade.create({
    data: { symbol: "ETHUSDT", interval: "15m", side: "SHORT", entryPrice: 3000, slPct: 1, tpPct: 1.5 },
  });
  check(!!s.id && !!f.id && !!a.id, "create across Suggestion + FinetuneRun + AutoTrade");

  // 3) Bảng biến mất giữa chừng (DB bị thay/đồng bộ sai) → P2021 → tự dựng lại + retry
  await db.$executeRawUnsafe(`DROP TABLE "Suggestion"`);
  const after = await db.suggestion.findMany();
  check(Array.isArray(after) && after.length === 0, "runtime DROP TABLE -> P2021 -> auto rebootstrap + retry");

  // 4) Ghi tiếp sau khi tự dựng lại
  const s2 = await db.suggestion.create({
    data: { ...suggestionData, symbol: "ETHUSDT", bias: "SHORT", prob: 0.4, entryPrice: 200 },
  });
  check(!!s2.id, "write works again after rebootstrap");

  console.log(`ALL BOOTSTRAP CHECKS PASSED (${passed})`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
