// v0.2.28 — test GIẢI PHẪU LỆNH (autopsy):
//  • computeEvidence — MFE/MAE/nhiễu/R tính từ nến thật (LONG + SHORT)
//  • klinesInWindow — covered chính xác (nến phủ tới entry hay không)
//  • autopsyPrompt — khối path là ground truth, có risk_officer + rules chặt
//  • parseAutopsyText + sanitizeAutopsy — đầu ra model được ép hình dạng an toàn
//  • setupPrompt lessons — bài học autopsy nạp vào prompt duyệt lệnh
//  • integration — mock llama-server: autopsyLlmCall gửi đúng schema "autopsy"
import http from "node:http";
import {
  autopsyLlmCall,
  autopsyPrompt,
  computeEvidence,
  klinesInWindow,
  parseAutopsyText,
  type AutopsyTradeInput,
} from "../src/lib/autopsy";
import { setupPrompt, type LlmSetup } from "../src/lib/llm";
import type { Kline } from "../src/lib/types";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, name: string): void => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
};

const k = (t: number, o: number, h: number, l: number, c: number): Kline => ({ t, o, h, l, c, v: 1, tb: 0 });

// lệnh LONG mẫu — entry 100, sl 2%, tp 4%, giữ 3 nến 15m
const longInput: AutopsyTradeInput = {
  id: "t1",
  symbol: "LINKUSDT",
  interval: "15m",
  side: "LONG",
  entryPrice: 100,
  entryTime: 1_700_000_000_000,
  exitPrice: 103.5,
  exitTime: 1_700_000_000_000 + 45 * 60_000,
  slPct: 2,
  tpPct: 4,
  leverage: 10,
  stakePct: 10,
  pnlPct: 35, // +3.5% giá × 10
  exitKind: "tp",
  prob: 0.62,
  acc: 71.4,
  auc: 0.81,
  score: 55.2,
  llmVerdict: "go",
  llmReason: "rr_check consistent",
};

const longKlines = [
  k(1_700_000_000_000 - 60_000, 100, 101.5, 99.0, 101.2), // nến chứa entry — MFE 1.5, MAE 1.0
  k(1_700_000_000_000 + 15 * 60_000, 101.2, 102.0, 100.5, 101.8), // MFE 2.0
  k(1_700_000_000_000 + 30 * 60_000, 101.8, 104.5, 101.8, 103.5), // MFE 4.5 → chạm vùng TP
  k(1_700_000_000_000 + 60 * 60_000, 103.5, 104.0, 103.0, 103.8), // SAU khi đóng — phải bị loại
];

console.log("── computeEvidence (LONG) ──");
const evLong = computeEvidence(klinesInWindow(longKlines, longInput).ks, longInput);
ok(evLong.mfePct === 4.5, `MFE = 4.5 (thật: ${evLong.mfePct}) — nến sau exit không tính`);
ok(evLong.maePct === 1.0, `MAE = 1.0 (thật: ${evLong.maePct})`);
ok(evLong.rMultiple === 1.75, `R = 1.75 (35 / (2×10)) (thật: ${evLong.rMultiple})`);
ok(evLong.durMin === 45, `giữ 45 phút (thật: ${evLong.durMin})`);
ok(evLong.candles === 3, `3 nến trong cửa sổ (thật: ${evLong.candles})`);
ok(evLong.noisePct > 0 && evLong.noisePct < 5, `nhiễu hợp lý (thật: ${evLong.noisePct})`);

console.log("── computeEvidence (SHORT) ──");
const shortInput: AutopsyTradeInput = { ...longInput, side: "SHORT", entryPrice: 100, exitPrice: 98.2, pnlPct: -18, exitKind: "sl", tpPct: 3, slPct: 1.8 };
const shortKlines = [
  k(1_700_000_000_000 - 60_000, 100, 100.9, 99.2, 99.5), // LONG nhìn: MFE 0.9 — SHORT nhìn: MFE 0.8 (l 99.2), MAE 0.9 (h 100.9)
  k(1_700_000_000_000 + 15 * 60_000, 99.5, 102.0, 99.4, 101.5), // MAE 2.0 → vượt SL 1.8
];
const evShort = computeEvidence(klinesInWindow(shortKlines, shortInput).ks, shortInput);
ok(evShort.mfePct === 0.8, `SHORT MFE = 0.8 (thật: ${evShort.mfePct})`);
ok(evShort.maePct === 2.0, `SHORT MAE = 2.0 (thật: ${evShort.maePct})`);
ok(evShort.rMultiple === -1, `R = -1 (-18 / (1.8×10)=18) (thật: ${evShort.rMultiple})`);

console.log("── klinesInWindow covered ──");
ok(klinesInWindow(longKlines, longInput).covered === true, "cửa sổ có nến chứa entry → covered");
const lateKlines = longKlines.slice(1); // thiếu nến chứa entry
ok(klinesInWindow(lateKlines, longInput).covered === false, "thiếu nến entry → NOT covered");

console.log("── autopsyPrompt ──");
const win = { ...klinesInWindow(longKlines, longInput), covered: true };
const ev = { ...computeEvidence(win.ks, longInput), covered: win.covered };
const { system, user } = autopsyPrompt(longInput, ev);
ok(user.includes("pair=LINKUSDT tf=15m side=LONG"), "user prompt có pair/tf/side");
ok(user.includes("risk_officer: verdict=go"), "risk_officer verdict=go có trong prompt");
ok(user.includes("path (computed by code from candles — ground truth"), "khối path tuyên bố ground truth");
ok(user.includes("DID reach the TP zone"), "MFE ≥ tp → DID reach");
ok(user.includes("pnl_roe=+35.00%"), "outcome có pnl_roe");
ok(system.includes("never contradict it, never invent numbers absent from it"), "system cấm bịa số");
ok(system.includes('"tag":"...","why":["..."],"lesson":"..."'), "system bắt JSON đúng hình");
// case THUA + dữ liệu thiếu
const loss = autopsyPrompt(
  { ...shortInput, llmVerdict: null, llmReason: null, prob: null },
  { ...computeEvidence([shortKlines[1]], shortInput), covered: false, candles: 1 },
);
ok(loss.user.includes("risk_officer: not reviewed"), "không qua LLM → not reviewed");
ok(loss.user.includes("model: not recorded"), "không có prob → model not recorded");
ok(loss.user.includes("window PARTIALLY covered"), "dữ liệu thiếu được nói thẳng, không bịa");
ok(loss.user.includes("NEVER reached the TP zone") || loss.user.includes("DID reach the TP zone"), "mfe_check vẫn có");

console.log("── parseAutopsyText / sanitize ──");
const rawOk = '```json\n{"tag":"Sl Too Tight!!","why":["mae_check: max adverse 2.00% >= sl 1.80%","noise high","x","y"],"lesson":"' + "a".repeat(300) + '"}\n```';
const parsed = parseAutopsyText(rawOk, "qwen2.5:7b", 8123, shortInput, evShort);
ok(parsed !== null, "parse được JSON bọc markdown");
if (parsed) {
  ok(parsed.tag === "sl_too_tight", `tag slug hoá (thật: ${parsed.tag})`);
  ok(parsed.why.length === 3, `why cắt còn 3 (thật: ${parsed.why.length})`);
  ok(parsed.why.every((w) => w.length <= 160), "mỗi why ≤ 160 ký tự");
  ok(parsed.lesson.length === 240, `lesson cắt còn 240 (thật: ${parsed.lesson.length})`);
  ok(parsed.outcome === "loss" && parsed.exitKind === "sl", "outcome/exitKind lấy từ lệnh, không tin model");
  ok(parsed.model === "qwen2.5:7b" && parsed.ms === 8123, "model/ms ghi nhận");
  ok(parsed.ev.maePct === 2.0, "evidence gắn vào JSON");
}
ok(parseAutopsyText("no json here", "m", 1, shortInput, evShort) === null, "không có JSON → null");
ok(parseAutopsyText('{"tag":"","why":[],"lesson":""}', "m", 1, shortInput, evShort) === null, "lesson rỗng → null (hỏng)");
const unlab = parseAutopsyText('{"tag":"","why":[],"lesson":"chờ nến xác nhận rồi mới vào"}', "m", 1, shortInput, evShort);
ok(unlab?.tag === "unlabeled", `tag rỗng → unlabeled (thật: ${unlab?.tag})`);

console.log("── setupPrompt nạp lessons ──");
const base: LlmSetup = {
  symbol: "LINKUSDT",
  interval: "15m",
  side: "SHORT",
  prob: 0.371,
  confidence: 0.26,
  auc: 0.845,
  acc: 78.1,
  slPct: 1.2,
  tpPct: 1.7,
  leverage: 20,
  stakePct: 10,
  horizon: 5,
  samples: 288,
  score: 66.5,
  gatePassed: true,
};
const withLessons = setupPrompt({ ...base, lessons: ["[15m SHORT sl -24.0% ROE · tag=sl_too_tight] widen SL beyond 1.5x avg candle noise", "[15m SHORT tp +45.0% ROE · tag=good_entry] keep entering this pullback shape"] });
ok(withLessons.includes("recent_lessons (post-mortems"), "prompt duyệt có khối recent_lessons");
ok(withLessons.includes("- [15m SHORT sl -24.0% ROE · tag=sl_too_tight]"), "bài học nguyên dạng có mặt");
ok(!setupPrompt(base).includes("recent_lessons"), "không có lessons → không chèn khối rỗng");

console.log("── integration — mock llama-server ──");
let receivedSystem = "";
let receivedUser = "";
let receivedSchema = "";
const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c: Buffer) => (body += c));
  req.on("end", () => {
    const j = JSON.parse(body) as { messages: { role: string; content: string }[]; response_format?: { json_schema?: { name?: string } } };
    receivedSystem = j.messages.find((m) => m.role === "system")?.content ?? "";
    receivedUser = j.messages.find((m) => m.role === "user")?.content ?? "";
    receivedSchema = j.response_format?.json_schema?.name ?? "";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                '{"tag":"noise_stop","why":["noise_check: per-candle noise is 0.71x the stop","mae_check: max adverse 1.28% >= sl 1.20%"],"lesson":"Place SL beyond 2x the average candle range on 15m breakouts."}',
            },
          },
        ],
      }),
    );
  });
});
await new Promise<void>((r) => srv.listen(0, r));
const addr = srv.address() as { port: number };
const call = await autopsyLlmCall(`http://127.0.0.1:${addr.port}/v1`, "qwen2.5:7b", system, user);
ok(call !== null, "mock server trả lời được đọc");
if (call) {
  ok(receivedSchema === "autopsy", `json_schema name "autopsy" (thật: ${receivedSchema})`);
  ok(receivedSystem.includes("post-mortem analyst"), "system prompt đi đúng đường");
  ok(receivedUser.includes("path_check: 3 candles"), "evidence đi nguyên trong user prompt");
  const j = parseAutopsyText(call.text, "qwen2.5:7b", call.ms, longInput, ev);
  ok(j?.tag === "noise_stop", `parse kết quả mock (thật: ${j?.tag})`);
  ok(j?.outcome === "win", "lệnh thắng → outcome win");
}
srv.close();

console.log(`\n${pass} pass · ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
