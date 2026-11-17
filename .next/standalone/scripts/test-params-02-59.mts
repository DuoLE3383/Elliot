// QA 0.2.59 — mở khóa nốt panel tham số: XGB hyper (xgbBase), TUNE_GRID,
// LLM_TIMEOUT_MS, UNIVERSE_TOP, SESS_SYMBOL (kiểu STRING mới) + catalog 7 nhóm
import { hydrateParams, setOverride, paramCatalog, EDITABLE } from "../src/lib/params-store.ts";
import { pval, xgbBase, XGB_BASE, SESS_SYMBOL, UNIVERSE_TOP, LLM_TIMEOUT_MS, TUNE_GRID } from "../src/lib/params.ts";

let fail = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
};

// 0) mặc định (chưa override)
check("xgbBase default = XGB_BASE", JSON.stringify(xgbBase()) === JSON.stringify(XGB_BASE));
check("pval TUNE_GRID default", pval("TUNE_GRID", TUNE_GRID) === true);
check("pval SESS_SYMBOL default", pval("SESS_SYMBOL", SESS_SYMBOL) === "BTCUSDT");
check("pval LLM_TIMEOUT_MS default", pval("LLM_TIMEOUT_MS", LLM_TIMEOUT_MS) >= 10_000);

// 1) XGB hyper override → xgbBase() thấy ngay
const r1 = setOverride("XGB_DEPTH", 5);
check("setOverride XGB_DEPTH ok", r1.ok && r1.overrides["XGB_DEPTH"] === 5);
check("xgbBase sees depth 5", xgbBase().depth === 5);
const r1b = setOverride("XGB_DEPTH", 99); // vượt max 10 → kẹp
check("XGB_DEPTH clamp max 10", r1b.ok && r1b.overrides["XGB_DEPTH"] === 10);
const r1c = setOverride("XGB_LR", 0.05);
check("XGB_LR override", r1c.ok && xgbBase().lr === 0.05);

// 2) TUNE_GRID bool
const r2 = setOverride("TUNE_GRID", false);
check("TUNE_GRID off", r2.ok && pval("TUNE_GRID", TUNE_GRID) === false);
setOverride("TUNE_GRID", null);
check("TUNE_GRID reset", pval("TUNE_GRID", TUNE_GRID) === true);

// 3) LLM_TIMEOUT_MS — UI nhập theo GIÂY (scale 1000)
const r3 = setOverride("LLM_TIMEOUT_MS", 60);
check("LLM_TIMEOUT 60s → 60_000ms", r3.ok && r3.overrides["LLM_TIMEOUT_MS"] === 60_000);
check("pval sees 60_000", pval("LLM_TIMEOUT_MS", LLM_TIMEOUT_MS) === 60_000);
const r3b = setOverride("LLM_TIMEOUT_MS", 9999); // vượt max 600s → kẹp 600_000
check("LLM_TIMEOUT clamp 600s", r3b.ok && r3b.overrides["LLM_TIMEOUT_MS"] === 600_000);
setOverride("LLM_TIMEOUT_MS", null);

// 4) UNIVERSE_TOP int
const r4 = setOverride("UNIVERSE_TOP", 50);
check("UNIVERSE_TOP 50", r4.ok && pval("UNIVERSE_TOP", UNIVERSE_TOP) === 50);
const r4b = setOverride("UNIVERSE_TOP", 2.6); // int → round 3, min 5 → 5
check("UNIVERSE_TOP clamp min 5", r4b.ok && r4b.overrides["UNIVERSE_TOP"] === 5);
setOverride("UNIVERSE_TOP", null);

// 5) SESS_SYMBOL — kiểu STRING: hợp lệ / trim / từ chối pattern / từ chối số
const r5 = setOverride("SESS_SYMBOL", "  ETHUSDT  ");
check("SESS_SYMBOL trim ok", r5.ok && r5.overrides["SESS_SYMBOL"] === "ETHUSDT");
check("pval sees ETHUSDT", pval("SESS_SYMBOL", SESS_SYMBOL) === "ETHUSDT");
const r5b = setOverride("SESS_SYMBOL", "btc-usd!");
check("SESS_SYMBOL pattern reject", !r5b.ok);
const r5c = setOverride("SESS_SYMBOL", 123 as unknown as string);
check("SESS_SYMBOL non-string reject", !r5c.ok);
const r5d = setOverride("SESS_SYMBOL", "");
check("SESS_SYMBOL empty reject", !r5d.ok);
setOverride("SESS_SYMBOL", null);
check("SESS_SYMBOL reset", pval("SESS_SYMBOL", SESS_SYMBOL) === "BTCUSDT");

// 6) catalog: 7 nhóm + 32 row + string item giữ nguyên view
hydrateParams();
const cat = paramCatalog();
check("catalog has 7 groups", cat.groups.length === 7);
check("catalog items >= 32", EDITABLE.length >= 32);
const groups = cat.groups.map((g) => g.name);
check("group Universe / sessions exists", groups.includes("Universe / sessions"));
const sess = cat.groups.flatMap((g) => g.items).find((i) => i.key === "SESS_SYMBOL")!;
check("SESS_SYMBOL catalog string + pattern", sess.type === "string" && sess.pattern === "^[A-Z0-9]{5,20}$" && sess.view === "BTCUSDT");
const to = cat.groups.flatMap((g) => g.items).find((i) => i.key === "LLM_TIMEOUT_MS")!;
check("LLM_TIMEOUT view in seconds (300)", to.view === 300 && to.unit === "s");
const depth = cat.groups.flatMap((g) => g.items).find((i) => i.key === "XGB_DEPTH")!;
check("XGB_DEPTH catalog present", depth.type === "number" && depth.def === XGB_BASE.depth);

// dọn sạch override test (file về rỗng)
setOverride("XGB_DEPTH", null);
setOverride("XGB_LR", null);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
