// ─── Tests 0.2.82 — DỜI TAB SUGGESTIONS / LAB / ANALYSIS TỪ TRANG CHỦ SANG /stats ──
//
// "hãy dời phần này (suggestion / lab / analystic) https://elliott.huyenbao.com/
//  qua trang https://elliott.huyenbao.com/stats" — nối tiếp Journal 0.2.80:
//   1. Trang chủ: khối 3 tab XOÁ hẳn — terminal thuần chart; import + handler
//      chết theo (SuggestionHistory/StrategyLab/DeepAnalysis/StrategyPies,
//      applyVariantLab, markVariantApplied, VariantRow) xoá sạch; tab
//      Context/Wyckoff của rail phải NGUYÊN VẸN (hồi quy).
//   2. /stats: khối tabs MỚI nằm sau picker, trước card journal; cùng
//      pickSym/pickTf điều khiển. ALL → Suggestions khoá scope "all" (prop
//      forceAll), Lab hiện note stats.labAll, Analysis giữ note
//      stats.analysisAll.
//   3. Analysis: DeepAnalysis + StrategyPies thay card Deep analysis cũ (xoá
//      hẳn — một nguồn sự thật /api/view + DEFAULT_SETTINGS, giữ basis note);
//      state analysis → view (ViewPayload) nuôi cả pies/n/gate; counts theo
//      view?.analysis.
//   4. Lab Apply: applyVariantStats merge utp.settings QUA CẤU HÌNH ĐÃ LƯU
//      (giữ leverage/utOn), KHÔNG gọi markVariantApplied (StrategyLab đã gọi
//      trước onApply), note xác nhận sl.applyToast + stats.labApplied.
//   5. suggestions.tsx: prop forceAll khoá scope "all" + ẩn nút chuyển; đường
//      thường (không truyền) giữ nguyên hành vi cũ.
//   6. i18n: stats.labAll + stats.labApplied đủ vi+en; stats.pick cập nhật;
//      mọi key tĩnh + các HỌ key động (analysis.trend.*, strat.*) mà 4 component
//      dời sang dùng đều tồn tại ở CẢ HAI dict.
//
// Run: npx tsx scripts/test-stats-tabs.mts

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

const home = readFileSync("src/app/page.tsx", "utf8");
const stats = readFileSync("src/app/stats/page.tsx", "utf8");
const sg = readFileSync("src/components/suggestions.tsx", "utf8");
const i18n = readFileSync("src/lib/i18n.ts", "utf8");

console.log("── 1. Trang chủ: terminal thuần chart, 3 tab dời hẳn ──");
check('không còn <Tabs defaultValue="suggest"', !home.includes('defaultValue="suggest"'));
check('không còn TabsTrigger value="lab" / value="analysis"', !home.includes('value="lab"') && !home.includes('value="analysis"'));
check('import SuggestionHistory xoá', !home.includes('from "@/components/suggestions"'));
check('import StrategyLab xoá', !home.includes('from "@/components/strategy-lab"'));
check('import DeepAnalysis xoá', !home.includes('from "@/components/analysis"'));
check('import StrategyPies xoá', !home.includes('from "@/components/strategy-pies"'));
check("applyVariantLab xoá sạch (khai báo + tham chiếu)", !home.includes("applyVariantLab"));
check("markVariantApplied + type VariantRow xoá khỏi import history", (() => {
  const m = home.match(/import \{[^}]*\} from "@\/lib\/history";/);
  return m ? !m[0].includes("markVariantApplied") && !m[0].includes("VariantRow") : false;
})());
check("import Tabs GIỮ (tab Context/Wyckoff vẫn dùng)", home.includes('import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";'));
check('rail Wyckoff của trang chủ nguyên vẹn (defaultValue="wyckoff")', home.includes('<Tabs defaultValue="wyckoff"') && home.includes('value="wyckoff"'));
check("chart card còn nguyên (PriceChart + fill trong Card giữa)", (() => {
  const card = home.indexOf('<Card className="flex min-h-0 ');
  const chart = home.indexOf("<PriceChart");
  const close = home.indexOf("</Card>", card);
  return card > -1 && chart > card && chart < close;
})());
check("histRefresh còn được wire (effect runs/aiSaved reload theo DB mutation)", /\}, \[symbol, interval, histRefresh\]\);/.test(home));
check("comment đánh dấu lần dời (0.2.82) có mặt", home.includes("0.2.82"));

console.log("── 2. /stats: khối tabs sau picker, trước card journal ──");
check("import Tabs + 4 component dời sang", (() => {
  return (
    /import \{ Tabs, TabsContent, TabsList, TabsTrigger \} from "@\/components\/ui\/tabs";/.test(stats) &&
    /import \{ SuggestionHistory \} from "@\/components\/suggestions";/.test(stats) &&
    /import \{ StrategyLab \} from "@\/components\/strategy-lab";/.test(stats) &&
    /import \{ DeepAnalysis \} from "@\/components\/analysis";/.test(stats) &&
    /import \{ StrategyPies \} from "@\/components\/strategy-pies";/.test(stats)
  );
})());
check("thứ tự 0.3.x: picker → card journal → trạm Analysis (tabs)", (() => {
  const pick = stats.indexOf("comboPicker");
  const journal = stats.indexOf('t(lang, "stats.section.journal")');
  const tabs = stats.indexOf('<Tabs defaultValue="suggest">');
  return pick > -1 && journal > pick && tabs > journal;
})());
check("đủ 3 tab dùng key tabs.suggest / tabs.lab / tabs.analysis (mảng trigger + TabsContent)", (() => {
  const start = stats.indexOf('<Tabs defaultValue="suggest">');
  const seg = stats.slice(start, stats.indexOf("</Tabs>", start));
  return ["suggest", "lab", "analysis"].every((v) => seg.includes(`v: "${v}"`) && seg.includes(`<TabsContent value="${v}"`)) && ["tabs.suggest", "tabs.lab", "tabs.analysis"].every((k) => seg.includes(`t(lang, "${k}")`));
})());
check("Suggestions: symbol={pickSym} + interval={pickTf} + refreshKey={tabsRefresh}", (() => {
  const seg = stats.slice(stats.indexOf("<SuggestionHistory"), stats.indexOf("</Tabs>", stats.indexOf("<SuggestionHistory")));
  return seg.includes("symbol={pickSym}") && seg.includes("interval={pickTf}") && seg.includes("refreshKey={tabsRefresh}");
})());
check("Suggestions: forceAll={pickSym === PICK_ALL} (ALL khoá scope all)", stats.includes("forceAll={pickSym === PICK_ALL}"));
check("Lab: ALL → note stats.labAll thay vì StrategyLab", (() => {
  const seg = stats.slice(stats.indexOf('<TabsContent value="lab"'), stats.indexOf('</TabsContent>', stats.indexOf('<TabsContent value="lab"')));
  return seg.includes('t(lang, "stats.labAll")') && seg.indexOf("stats.labAll") < seg.indexOf("<StrategyLab");
})());
check("Lab: onApply={applyVariantStats} (handler mới của /stats)", /onApply=\{applyVariantStats\}/.test(stats));
check("Lab: note xác nhận sl.applyToast + stats.labApplied khi labApplied", (() => {
  const seg = stats.slice(stats.indexOf("{labApplied && ("), stats.indexOf("<StrategyLab"));
  return seg.includes('t(lang, "sl.applyToast"') && seg.includes('t(lang, "stats.labApplied")');
})());

console.log("── 3. Analysis thay card Deep analysis cũ ──");
check('trạm Analysis riêng vẫn dùng title stats.section.analysis', stats.includes('t(lang, "stats.section.analysis")'));
check("card cũ XOÁ (không còn viền border-blue-500/70)", !stats.includes("border-blue-500/70"));
check("icon Search xoá; FlaskConical còn — giờ là icon NAV trạm Lab", !/\bSearch\b/.test(stats) && stats.includes("FlaskConical"));
check("state analysis → viewPayload: useState<ViewPayload | null>(null)", /const \[viewPayload, setViewPayload\] = useState<ViewPayload \| null>\(null\);/.test(stats));
check("fetchView import type ViewPayload", /import \{ fetchView, type ViewPayload \} from "@\/lib\/view";/.test(stats));
check("đường ALL: setViewPayload(null) (2 nhánh thành công + lỗi)", stats.split("setViewPayload(null);").length === 3);
check("đường 1 cặp: setViewPayload(v) — giữ nguyên payload thay vì chỉ analysis", /setViewPayload\(v\);/.test(stats) && !/setAnalysis/.test(stats));
check("counts nav: journal/lab đếm qua journal khi view khớp", /if \(journal && \(view === "journal" \|\| view === "lab"\)\) counts\[/.test(stats));
check("Analysis tab: DeepAnalysis a={view.analysis} + gate từ view.gate", (() => {
  const start = stats.indexOf("<DeepAnalysis");
  const seg = stats.slice(start, stats.indexOf("/>", start) + 2);
  return (
    seg.includes("a={viewPayload.analysis}") &&
    seg.includes("gateLong={viewPayload.gate.long}") &&
    seg.includes("gateShort={viewPayload.gate.short}") &&
    seg.includes("smaValue={viewPayload.gate.sma}") &&
    seg.includes("smaFilter={DEFAULT_SETTINGS.smaFilter}") &&
    seg.includes("smaPeriod={DEFAULT_SETTINGS.smaPeriod}")
  );
})());
check("Analysis tab: StrategyPies pies={view.pies} n={view.n} leverage DEFAULT", (() => {
  const start = stats.indexOf("<StrategyPies");
  const seg = stats.slice(start, stats.indexOf("/>", start) + 2);
  return seg.includes("pies={viewPayload.pies}") && seg.includes("n={viewPayload.n}") && seg.includes("leverage={DEFAULT_SETTINGS.leverage}");
})());
check("Analysis tab: ALL → note stats.analysisAll giữ nguyên hành vi card cũ", (() => {
  const seg = stats.slice(stats.indexOf('<TabsContent value="analysis"'), stats.indexOf("</TabsContent>", stats.indexOf('<TabsContent value="analysis"')));
  return seg.includes('t(lang, "stats.analysisAll")');
})());
check("Analysis tab: basis note của card cũ được giữ (stats.basis.analysis)", (() => {
  const seg = stats.slice(stats.indexOf('<TabsContent value="analysis"'), stats.indexOf("</TabsContent>", stats.indexOf('<TabsContent value="analysis"')));
  return seg.includes('t(lang, "stats.basis.analysis")');
})());
check("Analysis tab: nhánh loading/failed (clientBusy) giữ nguyên", (() => {
  const seg = stats.slice(stats.indexOf('<TabsContent value="analysis"'), stats.indexOf("</TabsContent>", stats.indexOf('<TabsContent value="analysis"')));
  return seg.includes("clientBusy ?") && seg.includes("failed to load candles");
})());
check("nút Refresh cũng bump tabsRefresh (tab tải lại theo combo)", /setTabsRefresh\(\(k\) => k \+ 1\); void load\(\);/.test(stats));

console.log("── 4. applyVariantStats — merge utp.settings ──");
check("đọc cấu hình ĐÃ LƯU rồi merge (giữ leverage/utOn của người dùng)", (() => {
  const seg = stats.slice(stats.indexOf("const applyVariantStats"), stats.indexOf("}, []);", stats.indexOf("const applyVariantStats")));
  return seg.includes('localStorage.getItem("utp.settings")') && seg.includes("...DEFAULT_SETTINGS,") && seg.includes("...prev,");
})());
check("ghi đủ 6 trường chiến lược của biến thể", (() => {
  const seg = stats.slice(stats.indexOf("const applyVariantStats"), stats.indexOf("}, []);", stats.indexOf("const applyVariantStats")));
  return ["slPct: v.config.slPct", "tpPct: v.config.tpPct", "atrKey: v.config.atrKey", "atrPeriod: v.config.atrPeriod", "smaFilter: v.config.smaFilter", "smaPeriod: v.config.smaPeriod"].every((s) => seg.includes(s));
})());
check("KHÔNG gọi markVariantApplied trong handler (StrategyLab đã gọi trước onApply)", (() => {
  const seg = stats.slice(stats.indexOf("const applyVariantStats"), stats.indexOf("}, []);", stats.indexOf("const applyVariantStats")));
  return !seg.includes("markVariantApplied");
})());
check("setLabApplied ghi name/sl/tp/key/period cho note xác nhận", (() => {
  const seg = stats.slice(stats.indexOf("const applyVariantStats"), stats.indexOf("}, []);", stats.indexOf("const applyVariantStats")));
  return seg.includes("setLabApplied({") && seg.includes("name: v.name");
})());
check("type EngineSettings import cho merge an toàn kiểu", /import \{ DEFAULT_SETTINGS, DEFAULT_WYCKOFF, SYMBOLS, type EngineSettings \} from "@\/lib\/types";/.test(stats));

console.log("── 5. suggestions.tsx: forceAll ──");
check("prop forceAll? khai báo + mặc định false trong signature", /forceAll\?: boolean;/.test(sg) && /refreshKey, forceAll = false \}: Props\)/.test(sg));
check("effScope = forceAll ? \"all\" : scope", /const effScope: Scope = forceAll \? "all" : scope;/.test(sg));
check("fetch theo effScope + deps [effScope, symbol, interval, refreshKey]", /effScope === "pair"\s*\n\s*\? await fetchSuggestions\(\{ symbol, interval, limit: 150 \}\)/.test(sg) && /\}, \[effScope, symbol, interval, refreshKey\]\);/.test(sg));
check("nút chuyển pair/all ẩn khi forceAll ({!forceAll &&", /\{!forceAll &&\s*\n?\s*\(\["pair", "all"\] as Scope\[\]\)\.map/.test(sg));
check("cột pair (desktop + mobile) + StatTile label + CSV base đều theo effScope", (() => {
  return (
    sg.split('effScope === "all"').length === 4 &&
    sg.includes('effScope === "pair" ? `${symbolLabel(symbol)} · ${interval}`') &&
    sg.includes('effScope === "pair" ? `de-xuat-${symbol}-${interval}`')
  );
})());
check("hồi quy: state scope vẫn khởi tạo \"pair\" (đường thường không đổi)", /useState<Scope>\("pair"\);/.test(sg));
check("hồi quy: nút chuyển vẫn setScope (chỉ bị ẩn, không xoá logic)", /onClick=\{\(\) => setScope\(sc\)\}/.test(sg));

console.log("── 6. i18n ──");
check('key mới "stats.labAll" đủ vi + en (x2)', ((i18n.match(/"stats\.labAll"/g)) ?? []).length === 2);
check('key mới "stats.labApplied" đủ vi + en (x2)', ((i18n.match(/"stats\.labApplied"/g)) ?? []).length === 2);
check('stats.pick cập nhật (nhắc cả tab terminal) vi + en', (() => {
  const vi = DICTS.vi["stats.pick"] ?? "";
  const en = DICTS.en["stats.pick"] ?? "";
  return vi.includes("tab") && en.includes("tab");
})());
// mọi key TĨN mà 4 component dời + 2 trang dùng đều tồn tại ở CẢ HAI dict
const files: [string, string][] = [
  ["suggestions.tsx", sg],
  ["strategy-lab.tsx", readFileSync("src/components/strategy-lab.tsx", "utf8")],
  ["analysis.tsx", readFileSync("src/components/analysis.tsx", "utf8")],
  ["strategy-pies.tsx", readFileSync("src/components/strategy-pies.tsx", "utf8")],
  ["stats/page.tsx", stats],
  ["page.tsx", home],
];
let missing = 0;
for (const [name, src] of files) {
  const used = [...new Set([...src.matchAll(/t\(lang, "((?:tabs|stats|sg|sl|analysis|strat|dock|chart)\.[^"]+)"/g)].map((m) => m[1]))];
  for (const k of used) {
    if (!(k in DICTS.vi) || !(k in DICTS.en)) {
      missing++;
      console.log(`    ⚠ ${name}: missing in ${!(k in DICTS.vi) ? "vi" : "en"}: ${k}`);
    }
  }
}
check("mọi key tĩnh tabs/stats/sg/sl/analysis/strat/dock/chart 6 file dùng đều có ở vi+en", missing === 0, `${missing} thiếu`);
// các HỌ key động (template literal) — pie label + trend/structure/vol/atr/rsi
const DYN = [
  "strat.safe", "strat.balanced", "strat.aggressive", // pies donut label (3 preset)
  "analysis.trend.up", "analysis.trend.down", "analysis.trend.neutral",
  "analysis.structure.breakout", "analysis.structure.inside", "analysis.structure.breakdown",
  "analysis.vol.low", "analysis.vol.normal", "analysis.vol.high",
  "analysis.atr.low", "analysis.atr.normal", "analysis.atr.high",
  "analysis.rsi.ob", "analysis.rsi.os", "analysis.rsi.neutral",
  "analysis.pies.tp", "analysis.pies.sl", "analysis.pies.liq", "analysis.pies.flip",
];
const dynMissing = DYN.filter((k) => !(k in DICTS.vi) || !(k in DICTS.en));
check("các họ key động (strat.* pies + analysis.*) đủ vi+en", dynMissing.length === 0, dynMissing.join(", "));

console.log("── 7. Hồi quy journal (0.2.80) ──");
check("Journal bare vẫn trong card journal sau stack chart", (() => {
  const stack = stats.indexOf('kind: "stack"');
  const jr = stats.indexOf("<Journal");
  return stack > -1 && jr > stack;
})());
check("papers wiring 2 đường giữ nguyên (ALL + 1 cặp)", /setJournalPapers\(j\.papers \?\? \[\]\);/.test(stats) && /setJournalPapers\(j \? j\.papers : null\);/.test(stats));
check("Journal showSymbol khi ALL", /showSymbol=\{pickSym === PICK_ALL\}/.test(stats));
check("tab Journal không quay lại trang chủ (xoá từ 0.2.80)", !home.includes("<Journal") && !home.includes('value="journal"'));

console.log(`\nRESULT stats-tabs: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
