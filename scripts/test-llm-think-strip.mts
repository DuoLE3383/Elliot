// ─── test: model think-mode (DeepSeek V3-style) — stripThink + parseVerdictText ──
// Tái hiện đúng hiện trường 0.2.89: 828 prompt + 120 gen = dừng max_tokens,
// <think> chưa đóng → content không còn JSON → "no-json" → UI "no verdict".
// Chạy: bun scripts/test-llm-think-strip.mts
import { parseVerdictText, stripThink } from "../src/lib/llm";

let fail = 0;
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) fail++;
};

// 1. think KHÔNG đóng (truncated ở max_tokens 120 — log thật của user)
const truncated = "<think>Okay, the setup shows val_acc=75.3% and AUC 0.782 which is strong";
ok("think không đóng → strip hết, không còn dấu {", stripThink(truncated) === "");
ok("think không đóng → no-json (chứ không phải bad-json)", parseVerdictText(stripThink(truncated)).detail === "no-json");

// 2. think ĐÓNG + JSON thật phía sau — đường server --reasoning-format=none
const closed = '<think>check rubric… {pseudo json draft}</think>\n{"verdict":"go","confidence":0.8,"reasons":["val_acc=75.3% not barely"]}';
const p2 = parseVerdictText(stripThink(closed));
ok("think đóng → JSON phía sau parse được", "verdict" in p2 && p2.verdict === "go" && p2.confidence === 0.8);

// 3. Bẫy regex greedy của bản cũ: think chứa {} → regex cũ bắt từ {pseudo… tới }
//    → JSON.parse hỏng → rơi catch-all "error". Bản mới strip trước → parse sạch.
const trap = '<think>{draft: {a: 1}}</think>{"verdict":"skip","confidence":0.6,"reasons":["gate not passed"]}';
const p3 = parseVerdictText(stripThink(trap));
ok("think chứa {} → không còn dính bẫy greedy", "verdict" in p3 && p3.verdict === "skip");

// 4. JSON có {...} nhưng parse hỏng → detail "bad-json" (trước đây = "error" gây hiểu nhầm)
const badJson = '{"verdict":"go", confidence: 0.8 "reasons":[]}';
ok("JSON hỏng → bad-json (không còn rơi vào error)", parseVerdictText(badJson).detail === "bad-json");

// 5. JSON hợp lệ nhưng verdict lạ → bad-verdict
const badVerdict = '{"verdict":"maybe","confidence":0.5,"reasons":[]}';
ok("verdict lạ → bad-verdict", parseVerdictText(badVerdict).detail === "bad-verdict");

// 6. JSON sạch không think — đường non-thinking model vẫn y như cũ
const clean = '{"verdict":"go","confidence":0.7,"reasons":["rr ok"]}';
const p6 = parseVerdictText(clean);
ok("JSON sạch (không think) → go", "verdict" in p6 && p6.verdict === "go");

// 7. stripThink không phá text thường
ok("text thường đi qua nguyên vẹn", stripThink('{"verdict":"go"}') === '{"verdict":"go"}');

if (fail > 0) {
  console.error(`FAIL — ${fail} case hỏng`);
  process.exit(1);
}
console.log("PASS: think-mode strip + parse detail đúng (no-json/bad-json/bad-verdict)");
