// ─── Tests 0.2.76 — dọn /ai: settings trong POPUP + đổi màu nền trang ─────────
//
// "clean up ai page. setting is open in popup... change background page color"
//   1. Popup Settings: Dialog mở từ header (nút ai.settings) — Tabs 2 tab:
//      "system" (ParamsEditor — không còn card knobs nằm trong trang) và
//      "llm" (connection Risk Officer dời khỏi card LLM)
//   2. Card LLM giữ nguyên STATUS + nút "Cấu hình LLM" mở thẳng tab llm
//   3. Nền trang đổi từ zinc-950 phẳng → #0a100f (teal-tinted) + glow radial
//   4. Dọn dãy dọc: 2 card giáo tĩnh gộp thành "About" gấp gọn mặc định;
//      engine + LLM lên đầu; evo + dive chung hàng (xl:grid-cols-2)
//   5. Sticky header — Settings/Refresh/lang luôn trong tầm tay
//   6. llmSetupOpen + localStorage utp.llmSetupOpen xoá sạch (popup thay thế)
//   7. i18n: key mới đủ vi + en; MỌI key t(lang,"ai.…") page dùng đều tồn tại
//      ở CẢ HAI dict (chống quên thêm một bên)
//
// Run: npx tsx scripts/test-ai-page.mts

import { readFileSync } from "fs";
import { DICTS } from "../src/lib/i18n";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const page = readFileSync("src/app/ai/page.tsx", "utf8");
const i18n = readFileSync("src/lib/i18n.ts", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");

console.log("── 1. Settings popup ──");
check("Dialog wired: open={settingsOpen} onOpenChange", page.includes('open={settingsOpen}') && page.includes("onOpenChange={setSettingsOpen}"));
check("state settingsOpen + settingsTab('system'|'llm')", /const \[settingsOpen, setSettingsOpen\] = useState\(false\)/.test(page) && /useState<"system" \| "llm">\("system"\)/.test(page));
check("Tabs 2 giá trị: system + llm", page.includes('<TabsTrigger\n                value="system"') || page.includes('value="system"') && page.includes('value="llm"'));
check("ParamsEditor nằm TRONG Dialog (index > DialogContent)", page.indexOf("<ParamsEditor") > page.indexOf("<DialogContent"));
check("ParamsEditor mount trong TabsContent system", (() => {
  const tab = page.indexOf('TabsContent value="system"');
  const ed = page.indexOf("<ParamsEditor");
  const tabEnd = page.indexOf('TabsContent value="llm"');
  return tab >= 0 && ed > tab && ed < tabEnd;
})());
check("header có nút Settings mở popup (setSettingsOpen(true))", (/setSettingsTab\("system"\);\s*setSettingsOpen\(true\);/.test(page)));
check("tab system dùng nhãn ai.knobs.title (giữ key cũ làm nhãn tab)", page.includes('t(lang, "ai.knobs.title")'));
check("tab system vẫn ghi chú ai.knobs.sub", page.includes('t(lang, "ai.knobs.sub")'));
check("tab llm chứa editor URL (llmDraftUrl trong TabsContent llm)", (() => {
  const tabLlm = page.indexOf('TabsContent value="llm"');
  const urlInput = page.indexOf("value={llmDraftUrl}");
  return tabLlm >= 0 && urlInput > tabLlm;
})());
check("dialog max-h + scroll nội dung (max-h-[88dvh] + rail-scroll overflow-y-auto)", page.includes("max-h-[88dvh]") && /TabsContent value="system"[\s\S]{0,120}rail-scroll/.test(page));

console.log("── 2. Card LLM = status + nút mở tab llm ──");
check("nút ai.llm.setup mở popup thẳng tab llm", /setSettingsTab\("llm"\);\s*setSettingsOpen\(true\);/.test(page));
check("editor LLM KHÔNG còn trong card LLM (saveLlmSetup chỉ gọi từ dialog)", (() => {
  const cardLlm = page.indexOf('ai.llm.title"');
  const dialogLlm = page.indexOf('TabsContent value="llm"');
  const saveCall = page.indexOf("void saveLlmSetup()");
  return saveCall > dialogLlm && !(cardLlm > 0 && saveCall > cardLlm && saveCall < dialogLlm);
})());
check("card LLM vẫn có nút duyệt thử (runLlmTest)", page.includes("void runLlmTest()"));
check("llmSetupOpen + utp.llmSetupOpen đã xoá", !page.includes("llmSetupOpen") && !page.includes("utp.llmSetupOpen"));

console.log("── 3. Nền trang ──");
check("nền mới #0a100f + glow radial teal", page.includes("bg-[#0a100f]") && page.includes("[background-image:radial-gradient(ellipse_75%_45%_at_50%_-8%,rgba(45,212,191,0.07),transparent)]"));
check("nền cũ zinc-950 phẳng đã xoá khỏi root", !page.includes("min-h-screen bg-zinc-950"));
check("sticky header (sticky top-0 + backdrop-blur)", /sticky top-0 z-30[\s\S]{0,120}backdrop-blur/.test(page));
check("layout themeColor khớp #0a100f", layout.includes('themeColor: "#0a100f"'));

console.log("── 4. Bố cục dọn trang ──");
check("About gấp gọn mặc định: aboutOpen=false + render điều kiện", /const \[aboutOpen, setAboutOpen\] = useState\(false\)/.test(page) && page.includes("{aboutOpen ? (") && page.includes(": null}"));
check("About chứa 2 lớp AI + Prob (layers.xgb.t + prob.warn)", page.includes('t(lang, "ai.layers.xgb.t")') && page.includes('t(lang, "ai.prob.warn")'));
check("thứ tự mới: engine TRƯỚC llm TRƯỚC reliab TRƯỚC data TRƯỚC autopsy", (() => {
  const order = ["ai.engine.title", "ai.llm.title", "ai.reliab.title", "ai.data.title", "ai.autopsy.title", "ai.champ.title", "ai.evo.title", "ai.dive.title", "ai.about.title"].map((k) => page.indexOf(`t(lang, "${k}")`));
  return order.every((v) => v >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]);
})());
check("engine + llm chung hàng 1, evo + dive chung hàng 2 (xl:grid-cols-2 ×2)", (() => {
  const rows = [...page.matchAll(/grid gap-4 xl:grid-cols-2/g)].map((m) => m.index ?? -1);
  const eng = page.indexOf('t(lang, "ai.engine.title")');
  const llm = page.indexOf('t(lang, "ai.llm.title")');
  const evo = page.indexOf('t(lang, "ai.evo.title")');
  const dive = page.indexOf('t(lang, "ai.dive.title")');
  return rows.length === 2 && rows[0] > -1 && rows[0] < eng && eng < llm && llm < rows[1] && rows[1] < evo && evo < dive;
})());
check("updated/build dồn vào header (không còn dòng riêng sau header)", page.indexOf("ai.updated") > page.indexOf("<header") && page.indexOf("ai.updated") < page.indexOf("</header>"));
check("cfg engine: giá trị dài wrap được trên mobile (min-w-0 break-words, bỏ shrink-0)", (() => {
  const mapStart = page.indexOf(".map(([k, v]) => (");
  const mapEnd = page.indexOf("))}", mapStart);
  const block = page.slice(mapStart, mapEnd);
  return mapStart > 0 && block.includes("min-w-0 break-words text-right font-mono font-bold") && !block.includes('className="shrink-0 font-mono font-bold text-zinc-200"');
})());
check("card knobs riêng trong body đã xoá (ai.knobs.title chỉ xuất hiện trong TabsTrigger)", (() => {
  const first = page.indexOf('t(lang, "ai.knobs.title")');
  const trigger = page.indexOf('TabsTrigger');
  return first > trigger;
})());

console.log("── 5. i18n ──");
const NEW_KEYS = ["ai.settings", "ai.settings.note", "ai.settings.tabLlm", "ai.about.title", "ai.about.more", "ai.about.less"];
for (const k of NEW_KEYS) {
  const n = (i18n.match(new RegExp(`"${k.replace(/\./g, "\\.")}"`, "g")) ?? []).length;
  check(`key mới "${k}" đủ vi + en (x2)`, n === 2, `got ${n}`);
}
// mọi key page dùng đều tồn tại ở CẢ HAI dict
const used = [...new Set([...page.matchAll(/t\(lang, "(ai\.[^"]+)"/g)].map((m) => m[1]))];
let missing = 0;
for (const k of used) {
  if (!(k in DICTS.vi) || !(k in DICTS.en)) {
    missing++;
    console.log(`    ⚠ missing in ${!(k in DICTS.vi) ? "vi" : "en"}: ${k}`);
  }
}
check(`mọi t(lang,"ai.*") page dùng đều có ở vi+en (${used.length} key)`, missing === 0, `${missing} thiếu`);
check("params-editor.tsx không đổi (ParamsEditor còn export)", readFileSync("src/components/params-editor.tsx", "utf8").includes("export function ParamsEditor"));

console.log("");
console.log(`RESULT ai-page: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
