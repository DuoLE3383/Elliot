// QA 0.2.72 — hai nâng cấp:
//  A. FLIP BẤT ĐỐI XỨNG — lật chiều cần prob ≥ FLIP_PROB_MIN THEO PHÍA MỚI +
//     score ≥ sàn vào lệnh + FLIP_SCORE_EXTRA (chi tiết cases ở test-autoflip
//     mục 2b; file này kiểm defaults + off-switch).
//  B. SL/TP ĐỘC LẬP ĐÒN BẨY — levNormScale (off/sqrt/lin, chỉ thu hẹp) +
//     levAdjSlTp (mui thanh khoản TP_LIQ_SAFE mọi tpMode, sàn 0.15%, R:R giữ).
import { levNormScale, levAdjSlTp, flipDecision, type ScanRow } from "../src/lib/autotrade.ts";
import { FLIP_PROB_MIN, FLIP_SCORE_EXTRA, TP_LEV_MODE, TP_LEV_REF, TP_LIQ_SAFE } from "../src/lib/params.ts";
import { setOverride } from "../src/lib/params-store.ts";
import { readFileSync } from "fs";

let fail = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── A · flip asymmetric — defaults + off ─────────────────────────────────────
console.log("1. defaults tham số flip");
check("FLIP_PROB_MIN = 0.62", FLIP_PROB_MIN === 0.62);
check("FLIP_SCORE_EXTRA = 10", FLIP_SCORE_EXTRA === 10);

const row = (over: Partial<ScanRow>): ScanRow =>
  ({
    symbol: "LINKUSDT", interval: "15m", prob: 0.75, confidence: 0.5, bias: "LONG",
    auc: 0.845, acc: 78.1, score: 66.5, samples: 288, valSamples: 92, horizon: 5,
    slPct: 1.2, tpPct: 1.7, atrCoef: 1.5, ...(over as Partial<ScanRow>),
  }) as ScanRow;
const open = { symbol: "LINKUSDT", interval: "15m", side: "SHORT" as const };
const cfg = { minAuc: 0.8, minAcc: 70, minScore: 60, whaleFilter: true };

console.log("2. off-switch: FLIP_PROB_MIN 0.5 + FLIP_SCORE_EXTRA 0 → hành vi đối xứng cũ");
setOverride("FLIP_PROB_MIN", 0.5);
setOverride("FLIP_SCORE_EXTRA", 0);
check("prob 0.58 / score 66.5 (đủ vào lệnh thường) → lật lại được", flipDecision(open, row({ bias: "LONG", prob: 0.58 }), cfg).ok === true);
setOverride("FLIP_PROB_MIN", null);
setOverride("FLIP_SCORE_EXTRA", null);
check("mặc định trở lại: prob 0.58 → chặn", flipDecision(open, row({ bias: "LONG", prob: 0.58, score: 72 }), cfg).ok === false);

// ── B · levNormScale ─────────────────────────────────────────────────────────
console.log("3. levNormScale — lin mặc định (ref 10), chỉ THU HẸP khi lev > ref");
check("lev 10 (ref) → 1", near(levNormScale(10), 1));
check("lev 20 → 0.5", near(levNormScale(20), 0.5));
check("lev 40 → 0.25", near(levNormScale(40), 0.25));
check("lev 5 → 1 (KHÔNG nới rộng — rủi ro chỉ nhỏ hơn baseline)", near(levNormScale(5), 1));
check("lev 1 → 1", near(levNormScale(1), 1));
check("lev 0 / NaN → 1 (an toàn)", near(levNormScale(0), 1) && near(levNormScale(NaN), 1));

console.log("4. levNormScale — mode sqrt + ref override + giá trị lạ");
setOverride("TP_LEV_MODE", "sqrt");
check("sqrt: lev 40 ref 10 → √0.25 = 0.5", near(levNormScale(40), 0.5));
check("sqrt: lev 10 → 1", near(levNormScale(10), 1));
setOverride("TP_LEV_REF", 20);
setOverride("TP_LEV_MODE", "lin");
check("lin ref 20: lev 40 → 0.5", near(levNormScale(40), 0.5));
check("lin ref 20: lev 10 → 1 (không nới)", near(levNormScale(10), 1));
setOverride("TP_LEV_MODE", "off");
check("off: lev 40 → 1 (legacy)", near(levNormScale(40), 1));
(globalThis as { __elliotParams?: Record<string, unknown> }).__elliotParams = { TP_LEV_MODE: "bogus" };
check("mode lạ (bypass store) → 1", near(levNormScale(40), 1));
(globalThis as { __elliotParams?: Record<string, unknown> }).__elliotParams = undefined;
setOverride("TP_LEV_MODE", null);
setOverride("TP_LEV_REF", null);
check("về mặc định: lin ref 10, lev 20 → 0.5", near(levNormScale(20), 0.5));

// ── C · levAdjSlTp — máy tính hoàn chỉnh ────────────────────────────────────
console.log("5. levAdjSlTp — scale + mui thanh khoản + sàn + R:R");
let a = levAdjSlTp(1.8, 2.52, 1, 10);
check("identity khi scale 1, không chạm mui (cap 6%)", near(a.slPct, 1.8) && near(a.tpPct, 2.52));
a = levAdjSlTp(1.8, 2.52, 0.5, 20);
check("lin lev 20: SL 1.8→0.9 · TP 2.52→1.26", near(a.slPct, 0.9) && near(a.tpPct, 1.26));
a = levAdjSlTp(5, 7, 1, 20);
check("mui mặc định 60%: lev 20 cap 3% → SL 5→3, TP 7→4.2", near(a.slPct, 3) && near(a.tpPct, 4.2));
a = levAdjSlTp(5, 7, 1, 50);
check("manual semantics (scale 1) vẫn ăn mui: lev 50 cap 1.2 → 1.2/1.68", near(a.slPct, 1.2) && near(a.tpPct, 1.68));
a = levAdjSlTp(0.06, 0.084, 1, 10);
check("sàn 0.15%: SL 0.06→0.15, TP theo → 0.21", near(a.slPct, 0.15) && near(a.tpPct, 0.21));
a = levAdjSlTp(0.06, 0.084, 1, 500);
check("mui < sàn (lev 500 cap 0.12%) → mui thắng, không sàn", near(a.slPct, 0.06));
a = levAdjSlTp(1.8, 2.52, 0.25, 40);
check("R:R 1.4 giữ nguyên sau scale (0.45/0.63, sai số làm tròn 2dp)", near(a.tpPct / a.slPct, 1.4, 0.03));
a = levAdjSlTp(5, 7, 1, 20);
check("R:R giữ nguyên sau mui (3/4.2)", near(a.tpPct / a.slPct, 7 / 5, 0.03));

console.log("6. độc lập ROE-at-SL — lin ref 10, SL gốc 1.8% (baseline 18% ROE)");
const roeAt = (lev: number): number => levAdjSlTp(1.8, 2.52, levNormScale(lev), lev).slPct * lev;
for (const lev of [10, 20, 40, 100]) {
  check(`lev ×${lev} → ROE-at-SL ≈ 18% (được ${roeAt(lev).toFixed(2)}%)`, near(roeAt(lev), 18, 0.06));
}
// lev 80: SL 0.225 làm tròn XUỐNG 0.22 → 17.6% — làm tròn chỉ đi về phía
// AN TOÀN (ROE-at-SL không bao giờ VƯỢT baseline vì rounding)
check("lev ×80 → 17.6% (floor 0.225→0.22, chỉ đi về phía an toàn)", near(roeAt(80), 17.6, 0.01) && roeAt(80) <= 18.01);
for (const lev of [1, 5]) {
  check(`lev ×${lev} (dưới ref) → ROE-at-SL ≤ 18% (được ${roeAt(lev).toFixed(2)}%)`, roeAt(lev) <= 18.01);
}

// ── D · wiring ───────────────────────────────────────────────────────────────
console.log("7. wiring engine.ts / params-store.ts");
const eng = readFileSync("src/lib/engine.ts", "utf8");
const ps = readFileSync("src/lib/params-store.ts", "utf8");
check("engine: áp levAdjSlTp ở CẢ HAI luồng (entry + flip)", eng.includes("levAdjSlTp(entrySl, entryTp") && eng.includes("levAdjSlTp(slPct, tpPct"));
check("engine: lệnh ghi finalSl/finalTp (2 create)", (eng.match(/slPct: finalSl,/g) ?? []).length === 2);
check("engine: LLM duyệt theo SL/TP ĐÃ hiệu chỉnh (finalSl vào llmGate)", eng.includes("finalSl,\n      finalTp,") || eng.includes("finalSl, finalTp"));
check("engine: manual bỏ scale nhưng vẫn mui (ternary manual ? 1)", (eng.match(/c\.tpMode === "manual" \? 1 : levNormScale\(p\.leverage\)/g) ?? []).length === 2);
check("engine: msgOpen ATR note có lev-norm khi scale < 1", eng.includes("lev-norm ×"));
check("params-store: nhóm Flip / SL-TP đủ 5 núm", ["FLIP_PROB_MIN", "FLIP_SCORE_EXTRA", "TP_LEV_MODE", "TP_LEV_REF", "TP_LIQ_SAFE"].every((k) => ps.includes(`"${k}"`)));
check("params-store: TP_LEV_MODE pattern chặn giá trị lạ", ps.includes("^(off|sqrt|lin)$"));
check("mặc định: TP_LEV_MODE lin · TP_LEV_REF 10 · TP_LIQ_SAFE 60", TP_LEV_MODE === "lin" && TP_LEV_REF === 10 && TP_LIQ_SAFE === 60);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
