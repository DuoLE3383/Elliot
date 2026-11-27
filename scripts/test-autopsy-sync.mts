// v0.2.33 — test ĐỒNG BỘ AUTOPSY (2 sửa đổi sau bug thật 01/11):
//   1. THỨ TỰ URL LLM: env (LLM_URL/LLAMA_SERVER_URL) phải THẮNG opts.url
//      (cfg engine lưu DB). Bug thật: cfg.llmUrl cũ "http://127.0.0.8:8888"
//      trong DB thắng env → LLM không trả lời → autopsy bị bỏ write-once →
//      /ai "chưa có bài giải phẫu" vĩnh viễn dù DB đầy lệnh đóng.
//   2. BACKFILL: mổ bổ sung các lệnh closed còn thiếu autopsy — idempotent,
//      bound take:max, bỏ row dị dạng (exitTime null), không đụng lệnh open.
// dùng: DATABASE_URL=file:/tmp/db-autopsy-sync-test.db npx tsx scripts/test-autopsy-sync.mts
import fs from "node:fs";
import http from "node:http";

const dbFile = (process.env.DATABASE_URL ?? "").replace(/^file:/, "").split("?")[0];
if (!dbFile) {
  console.log("❌ thiếu DATABASE_URL (file:...)");
  process.exit(1);
}
if (fs.existsSync(dbFile)) fs.rmSync(dbFile);

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = ""): void => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

// ─── mock llama-server — trả autopsy JSON hợp lệ, đếm số request tới nó ──────
const AUTOPSY_BODY =
  '{"tag":"noise_stop","why":["noise_check: per-candle noise is 0.71x the stop"],"lesson":"Place SL beyond 2x the average candle range on 15m breakouts."}';
let mockHits = 0;
const srv = http.createServer((_req, res) => {
  mockHits += 1;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content: AUTOPSY_BODY } }] }));
});
await new Promise<void>((r) => srv.listen(0, r));
const mockUrl = `http://127.0.0.1:${(srv.address() as { port: number }).port}/v1`;

// env TRƯỚC mọi call — llmEnvEndpoint đọc process.env lúc gọi
process.env.LLM_URL = mockUrl;
process.env.LLM_MODEL = "mock-7b";

const { db } = await import("../src/lib/db");
const { autopsyBackfill, autopsyClosedTrade } = await import("../src/lib/autopsy");

// ─── seed ─────────────────────────────────────────────────────────────────────
const H = 3_600_000;
const now = Date.now();
const base = {
  symbol: "LINKUSDT",
  interval: "15m",
  side: "LONG",
  entryPrice: 100,
  entryTime: new Date(now - 4 * H),
  slPct: 1.2,
  tpPct: 1.7,
  leverage: 10,
  stakePct: 10,
  prob: 0.62,
  acc: 71.4,
  auc: 0.81,
  score: 55.2,
  llmVerdict: "go",
};
const mk = async (over: Record<string, unknown>): Promise<string> => {
  const r = await db.autoTrade.create({ data: { ...base, ...over } as never });
  return r.id;
};
const idA = await mk({ status: "closed", exitPrice: 103.5, exitTime: new Date(now - 1 * H), pnlPct: 35, exitKind: "tp" }); // mới nhất, thiếu autopsy
const idB = await mk({ status: "closed", exitPrice: 98.9, exitTime: new Date(now - 3 * H), pnlPct: -11, exitKind: "sl" }); // cũ hơn, thiếu
const idC = await mk({
  status: "closed",
  exitPrice: 101,
  exitTime: new Date(now - 2 * H),
  pnlPct: 10,
  exitKind: "manual",
  autopsy: JSON.stringify({ outcome: "win", tag: "good_entry", why: ["x"], lesson: "đã mổ sẵn" }),
});
await mk({ status: "open", entryTime: new Date(now - 1 * H) }); // D — lệnh mở
const idE = await mk({ status: "closed", exitPrice: 99, pnlPct: -10, exitKind: "sl", exitTime: null }); // E — dị dạng

const autopsyOf = async (id: string): Promise<string | null> =>
  (await db.autoTrade.findUnique({ where: { id } }))?.autopsy ?? null;

console.log("\n═══ 1. backfill lần 1 — mổ đúng các lệnh thiếu, bỏ open/đã mổ/dị dạng ═══");
const n1 = await autopsyBackfill(10);
check("backfill trả về 2 (A + B)", n1 === 2, `thật: ${n1}`);
check("A có autopsy (WIN → tag good_entry theo policy 0.4.x)", (await autopsyOf(idA))?.includes("good_entry") ?? false);
check("B có autopsy (lệnh THUA cũng mổ)", (await autopsyOf(idB))?.includes("noise_stop") ?? false);
check("C giữ nguyên autopsy cũ", (await autopsyOf(idC))?.includes("good_entry") ?? false);
check("E dị dạng (exitTime null) KHÔNG bị mổ", (await autopsyOf(idE)) === null);
check("mock server nhận đúng 2 request", mockHits === 2, `thật: ${mockHits}`);

console.log("\n═══ 2. idempotent — chạy lại không mổ thêm ═══");
const hitsBefore = mockHits;
const n2 = await autopsyBackfill(10);
check("lần 2 trả về 0", n2 === 0, `thật: ${n2}`);
check("mock không nhận thêm request", mockHits === hitsBefore, `tăng: ${mockHits - hitsBefore}`);

console.log("\n═══ 3. bound — take:max chặn số lệnh mổ mỗi lượt ═══");
for (let i = 0; i < 3; i++) {
  await mk({ status: "closed", exitPrice: 100.5, exitTime: new Date(now - 10 * H - i * H), pnlPct: 5, exitKind: "tp" });
}
const n3 = await autopsyBackfill(2);
check("3 lệnh chờ, max=2 → chỉ mổ 2", n3 === 2, `thật: ${n3}`);
const left = await db.autoTrade.count({ where: { status: "closed", autopsy: null, exitTime: { not: null } } });
check("còn lại đúng 1 lệnh chờ", left === 1, `thật: ${left}`);

console.log("\n═══ 4. env THẮNG opts.url — đúng chuẩn chung của app ═══");
const idI = await mk({ status: "closed", exitPrice: 102, exitTime: new Date(now - 30 * 60_000), pnlPct: 20, exitKind: "tp" });
const rowI = await db.autoTrade.findUnique({ where: { id: idI } });
const hitsI = mockHits;
// opts.url trỏ URL CHẾT (cfg.llmUrl cũ kiểu 127.0.0.8:8888) — env phải thắng
const jI = await autopsyClosedTrade(rowI!, { url: "http://127.0.0.1:9/v1", model: "dead-model" });
check("autopsyClosedTrade vẫn thành công qua env (WIN → good_entry)", jI !== null && jI.tag === "good_entry");
check("request đi vào mock (không vào URL chết)", mockHits === hitsI + 1, `thật: ${mockHits}`);

console.log("\n═══ 5. env trống → opts.url (cfg) vẫn được dùng ═══");
delete process.env.LLM_URL;
delete process.env.LLAMA_SERVER_URL;
const idJ = await mk({ status: "closed", exitPrice: 97, exitTime: new Date(now - 6 * H), pnlPct: -30, exitKind: "sl" });
const rowJ = await db.autoTrade.findUnique({ where: { id: idJ } });
const hitsJ = mockHits;
const jJ = await autopsyClosedTrade(rowJ!, { url: mockUrl, model: "mock-7b" });
check("không env → opts.url (mock) dùng được", jJ !== null && jJ.tag === "noise_stop");
check("request đi vào mock qua opts", mockHits === hitsJ + 1, `thật: ${mockHits}`);

srv.close();
console.log(`\n${pass} pass · ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
