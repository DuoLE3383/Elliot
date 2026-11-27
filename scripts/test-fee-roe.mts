// QA 0.2.77 — PHÍ GIAO DỊCH TRONG ROI ("add fees in trade for calculator ROI"):
//  A. feeRoi — máy tính phí theo (lev, sides): sàn thu trên NOTIONAL mỗi bên,
//     margin = notional/lev → mỗi bên ăn FEE_PCT × lev (% ROI). Round-trip
//     ×10 = −1.0% ROI kể cả khi giá đứng im. FEE_PCT runtime qua pval, 0 = off.
//  B. Settlement — CẢ HAI cửa chốt lệnh (closeTradeDirect engine + PATCH
//     /api/autotrade close) trừ round-trip 2 bên; thanh lý vẫn −100; phí không
//     kéo ROI xuống dưới đáy −100.
//  C. Telegram — msgOpen có dòng 🧾 phí round-trip, msgClose ghi rõ phí đã trừ;
//     FEE_PCT = 0 → hai dòng biến mất (off sạch sẽ).
//  D. KHÔNG ĐỤNG hình học giá — roiOf/slTpHit/nearHit thuần như cũ (SL/TP
//     trigger theo GIÁ, phí không dịch mức SL/TP); papers.ts (đơn giả lập,
//     kpi "fees excluded") không hề biết đến feeRoi.
//  E. params-store — FEE_PCT thuộc nhóm Flip / SL-TP, clamp biên, override
//     roundtrip.
import { feeRoi, roiOf, slTpHit, nearHit } from "../src/lib/autotrade.ts";
import { msgOpen, msgClose } from "../src/lib/tg-msgs.ts";
import { FEE_PCT } from "../src/lib/params.ts";
import { setOverride, paramCatalog } from "../src/lib/params-store.ts";
import type { AutoTradeRow } from "../src/lib/autotrade.ts";
import { readFileSync } from "fs";

let fail = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── A · feeRoi — công thức ────────────────────────────────────────────────────
console.log("1. feeRoi — mặc định FEE_PCT 0.05 (%/bên, taker USDT-M)");
check("FEE_PCT default = 0.05", FEE_PCT === 0.05);
check("lev ×10 round-trip → 2 × 0.05 × 10 = 1.0", near(feeRoi(10), 1));
check("lev ×10 một bên → 0.5", near(feeRoi(10, 1), 0.5));
check("lev ×20 round-trip → 2.0", near(feeRoi(20), 2));
check("lev ×1 (spot) round-trip → 0.1", near(feeRoi(1), 0.1));
check("sides=3 (DCA 2 tranche + exit) → 1.5 @ ×10", near(feeRoi(10, 3), 1.5));
check("lev 0 / âm / NaN → 0 (an toàn)", feeRoi(0) === 0 && feeRoi(-5) === 0 && feeRoi(NaN) === 0);

console.log("2. feeRoi — override runtime + off-switch");
setOverride("FEE_PCT", 0.02);
check("FEE_PCT 0.02: ×10 RT → 0.4 (maker realistic)", near(feeRoi(10), 0.4));
setOverride("FEE_PCT", 0);
check("FEE_PCT 0 → 0 mọi lev (off, gross như trước 0.2.77)", feeRoi(10) === 0 && feeRoi(20) === 0);
setOverride("FEE_PCT", null);
check("về mặc định: ×10 RT → 1.0", near(feeRoi(10), 1));
(globalThis as { __elliotParams?: Record<string, unknown> }).__elliotParams = { FEE_PCT: "bogus" };
check("giá trị lạ (bypass store) → pval fallback default 1.0", near(feeRoi(10), 1));
(globalThis as { __elliotParams?: Record<string, unknown> }).__elliotParams = undefined;

// ── B · Settlement — công thức ở CẢ HAI cửa chốt ─────────────────────────────
console.log("3. công thức settlement — đối chiếu tay");
// LONG entry 100 → exit 101 (move +1%) @ ×10: gross +10, phí RT 1.0 → +9.0
const netLong = Math.round((1 * 10 - feeRoi(10)) * 100) / 100;
check("LONG +1% giá @ ×10 → ROI net +9.00 (gross 10 − phí 1)", near(netLong, 9));
// giá ĐỨNG IM tại exit = entry: ROI net = −1.0 (chỉ còn phí)
const netFlat = Math.round((0 * 10 - feeRoi(10)) * 100) / 100;
check("giá đứng im @ ×10 → ROI net −1.00 (thuần phí round-trip)", near(netFlat, -1));
// SHORT exit 99: cùng biên độ đối xứng
const netShort = Math.round((1 * 10 - feeRoi(10)) * 100) / 100;
check("SHORT −1% giá @ ×10 → ROI net +9.00 (đối xứng LONG)", near(netShort, 9));
// spot (lev 1): phí chỉ 0.1
const netSpot = Math.round((1 * 1 - feeRoi(1)) * 100) / 100;
check("lev ×1 +1% giá → +0.90 (phí spot 0.1)", near(netSpot, 0.9));

console.log("4. wiring — engine.ts closeTradeDirect + PATCH /api/autotrade");
const eng = readFileSync("src/lib/engine.ts", "utf8");
const rt = readFileSync("src/app/api/autotrade/route.ts", "utf8");
const at = readFileSync("src/lib/autotrade.ts", "utf8");
check("engine: trừ phí trong pnlPct (movePct × lev − feeRoi)", eng.includes("movePct * row.leverage - feeRoi(row.leverage)"));
check("route: PATCH close CÙNG công thức (một settlement, hai cửa)", rt.includes("movePct * row.leverage - feeRoi(row.leverage)"));
check("cả hai import feeRoi từ autotrade", eng.includes("feeRoi,") && (rt.match(/import \{ feeRoi \} from "@\/lib\/autotrade";/) ?? []).length === 1);
check("thanh lý vẫn −100 (margin sạch — phí chẳng còn gì để trừ)", (eng.match(/remPnl = -100;/g) ?? []).length >= 1 && rt.includes("remPnl = -100;"));
check("phí không kéo ROI dưới đáy −100 (clamp)", eng.includes("else if (remPnl < -100) remPnl = -100;") && rt.includes("else if (remPnl < -100) remPnl = -100;"));
// 0.2.78: feeRoi chuyển nhà từ autotrade.ts sang ./params (llm.ts cần chính công
// thức đó cho prompt fee_check mà không được import autotrade → vòng); autotrade
// re-export nên engine/tg-msgs/route giữ nguyên import — vẫn một thuật toán.
const pm = readFileSync("src/lib/params.ts", "utf8");
check("feeRoi đọc FEE_PCT runtime (pval) — định nghĩa ở params.ts từ 0.2.78", pm.includes('pval("FEE_PCT", FEE_PCT)') && !at.includes('pval("FEE_PCT", FEE_PCT)'));
check("autotrade re-export feeRoi từ ./params (engine/tg-msgs/route không đổi import)", at.includes('export { CONF_W, NEAR_FRAC, REGRESS_EPS, feeRoi } from "./params";'));

// ── C · Telegram — phí nhìn thấy được ────────────────────────────────────────
console.log("5. msgOpen / msgClose — dòng phí");
const t = (lev: number): AutoTradeRow =>
  ({
    id: "t1", symbol: "LINKUSDT", interval: "15m", side: "LONG",
    entryPrice: 11.793, entryTime: new Date().toISOString(),
    slPct: 1.4, tpPct: 2.0, leverage: lev, stakePct: 10, status: "OPEN",
    exitPrice: 11.912, exitTime: new Date().toISOString(), pnlPct: 9,
    exitKind: "tp", prob: 0.8, acc: 75, auc: 0.78, score: 61.7,
    capitalBefore: 76755.1, capitalAfter: 78522.6, createdAt: new Date().toISOString(),
  }) as AutoTradeRow;
const mo = msgOpen(t(10), 76755.1);
check("msgOpen có dòng 🧾 Fees (round-trip) −1.00% ROI (format 0.4.x)", mo.includes("🧾 Fees (round-trip) −1.00% ROI — already counted in realized ROI"));
check("msgOpen giải thích realized ROI là sau phí", mo.includes("already counted in realized ROI"));
const mc = msgClose(t(10), 28, 46, -40.3);
check("msgClose PnL kèm 'fees −1.00%'", mc.includes("fees −1.00%"));
check("msgClose PnL vẫn là số sau phí từ settlement", mc.includes("PnL (ROI): <b>+9.00%</b>"));
setOverride("FEE_PCT", 0);
check("FEE_PCT 0 → msgOpen KHÔNG có dòng 🧾", !msgOpen(t(10), 76755.1).includes("🧾"));
check("FEE_PCT 0 → msgClose KHÔNG có 'fees −'", !msgClose(t(10), 28, 46, -40.3).includes("fees −"));
setOverride("FEE_PCT", null);

// ── D · KHÔNG ĐỤNG hình học giá ──────────────────────────────────────────────
console.log("6. roiOf / slTpHit / nearHit — thuần như cũ (phí không dịch mức SL/TP)");
check("roiOf LONG 100→101 @ ×10 = +10 (GROSS, không phí)", roiOf("LONG", 100, 101, 10) === 10);
check("roiOf SHORT 100→99 @ ×10 = +10", roiOf("SHORT", 100, 99, 10) === 10);
check("roiOf giá đứng im = 0 (phí không rò vào hình học)", roiOf("LONG", 100, 100, 10) === 0);
check("slTpHit vẫn theo GIÁ: LONG 100 rơi 98.8, SL 1.2% → 'sl'", slTpHit("LONG", 98.8, 100, 1.2, 1.68) === "sl");
check("slTpHit: LONG 100 lên 101.7, TP 1.68% → 'tp'", slTpHit("LONG", 101.7, 100, 1.2, 1.68) === "tp");
check("slTpHit: 100.5 → null (chưa chạm)", slTpHit("LONG", 100.5, 100, 1.2, 1.68) === null);
check("nearHit: 101.2 trong dải sắp TP (≥ 0.7 × 1.68 = 1.176)", nearHit("LONG", 101.2, 100, 1.2, 1.68) === "tp");
const papers = readFileSync("src/lib/papers.ts", "utf8");
const kpi = readFileSync("src/components/kpi.tsx", "utf8");
const strip = readFileSync("src/components/open-position-strip.tsx", "utf8");
check("papers.ts KHÔNG dùng feeRoi (đơn giả lập giữ gross — kpi 'fees excluded' vẫn đúng)", !papers.includes("feeRoi"));
check("floating displays (kpi/strip) KHÔNG đụng phí — ROI tạm = hình học giá", !kpi.includes("feeRoi") && !strip.includes("feeRoi"));
check("engine status ROI tạm vẫn gross (roiOf(open…)", eng.includes("roiOf(open.side, open.entryPrice, price, open.leverage)"));

// ── E · params-store — catalog + clamp ───────────────────────────────────────
console.log("7. params-store — FEE_PCT chỉnh runtime nhóm Flip / SL-TP");
const cat = paramCatalog();
const feeItem = cat.groups.flatMap((g) => g.items).find((i) => i.key === "FEE_PCT");
check("catalog có FEE_PCT", feeItem != null);
check("nhóm Flip / SL-TP (cùng tầng position-math, không thêm nhóm mới)", cat.groups.find((g) => g.items.some((i) => i.key === "FEE_PCT"))?.name === "Flip / SL-TP");
check("def 0.05 · min 0 (off) · max 0.5 · step 0.01", feeItem?.def === 0.05 && feeItem?.min === 0 && feeItem?.max === 0.5 && feeItem?.step === 0.01);
setOverride("FEE_PCT", 5);
const catClamped = paramCatalog();
check("clamp: nhập 5 → 0.5 (trần catalog)", catClamped.groups.flatMap((g) => g.items).find((i) => i.key === "FEE_PCT")?.value === 0.5 && near(feeRoi(10, 1), 0.5 * 10));
setOverride("FEE_PCT", null);
check("reset về mặc định: ×10 RT → 1.0", near(feeRoi(10), 1));

// ── F · i18n — ghi chú phí hai ngôn ngữ ──────────────────────────────────────
console.log("8. i18n — settings.note + stats.basis.combo nhắc phí (vi + en)");
const i18n = readFileSync("src/lib/i18n.ts", "utf8");
check("settings.note vi nói ROI chốt đã trừ phí (FEE_PCT)", i18n.includes("ROI CHỐT LỆNH đã trừ phí giao dịch round-trip"));
check("settings.note en nói realized ROI net of fees", i18n.includes("Realized (settled) ROI is net of round-trip trading fees"));
check("stats.basis.combo vi/en: thắng = pnlPct SAU PHÍ", i18n.includes("pnlPct, đã trừ phí round-trip") && i18n.includes("pnlPct, net of round-trip fees"));
const stats = readFileSync("src/lib/stats.ts", "utf8");
check("stats.ts Net ROI sum hint: net of round-trip fees", stats.includes("net of round-trip fees since 0.2.77"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
