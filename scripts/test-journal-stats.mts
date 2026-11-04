// ─── Tests 0.2.80 — MERGE journal vào /stats + FULL WIDTH /stats & /ai ────────
//
// "Merge pic 1 session to pic 2 and move to the stats page... Make the stat
//  and AI page full width"
//   1. /api/journal trả `papers` (mảng Paper của CHÍNH cửa sổ 200 nến) — bảng
//      tương tác trên /stats cùng một nguồn sự thật với các ô KPI (khớp 1:1);
//      ALL = nối liền papers mọi cặp, sort ổn định theo exitTime.
//   2. Journal component: prop `bare` (nhúng trong card cha, không Card wrapper,
//      vẫn đủ filter chips + Export CSV + đếm lệnh theo filter) + prop
//      `showSymbol` (cột SYMBOL cho chế độ ALL; CSV có cột Symbol từ trước).
//   3. /stats: Journal bare nằm TRONG card Trade journal (sau stack chart),
//      papers wiring đủ 2 đường fetch (ALL + single), ALL → showSymbol.
//   4. Trang chủ: tab Journal XOÁ (dời hẳn sang /stats) — defaultValue
//      "suggest", chỉ còn suggest/lab/analysis, import Journal xoá sạch.
//   5. FULL WIDTH: /stats + /ai bỏ max-w-6xl (header + body); grid section
//      /stats 3 cột trên 2xl; KPI journal/analysis 3 cột trên xl.
//   6. i18n: journal.col.symbol đủ vi+en; tabs.journal xoá ở cả 2 dict; mọi
//      key journal.*/stats.* 2 trang dùng đều tồn tại ở CẢ HAI dict.
//
// 0.2.82 UPDATE: mục 3 đổi mốc (card Deep analysis cũ XOÁ — Analysis nhập vào
// khối tabs terminal); mục 4 đảo chiều (3 tab suggest/lab/analysis cũng dời
// sang /stats theo Journal — trang chủ thuần chart). Chi tiết đầy đủ ở
// scripts/test-stats-tabs.mts.
//
// Run: npx tsx scripts/test-journal-stats.mts

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

const route = readFileSync("src/app/api/journal/route.ts", "utf8");
const journal = readFileSync("src/components/journal.tsx", "utf8");
const stats = readFileSync("src/app/stats/page.tsx", "utf8");
const home = readFileSync("src/app/page.tsx", "utf8");
const ai = readFileSync("src/app/ai/page.tsx", "utf8");
const i18n = readFileSync("src/lib/i18n.ts", "utf8");

console.log("── 1. /api/journal trả papers ──");
check("JournalPayload có trường papers: Paper[]", /papers: Paper\[\];/.test(route));
check("journalOne trả papers: res.papers (cùng papersFrom với KPI)", /basis: signals\.length, papers: res\.papers \}/.test(route));
check("import type Paper từ ./types", /import type \{ Paper \} from "@\/lib\/types";/.test(route));
check("ALL: flatMap papers mọi cặp + sort exitTime desc (ổn định bất kể thứ tự Promise.all)", /const papers = per\s*\n?\s*\.flatMap\(\(p\) => p\.papers\)\s*\n?\s*\.sort\(\(a, b\) => \(b\.exitTime \?\? b\.entryTime\) - \(a\.exitTime \?\? a\.entryTime\)\);/.test(route));
check("ALL: payload gán papers", /per,\s*\n\s*failed,\s*\n\s*papers,/.test(route));
check("1 cặp: payload gán papers: r.papers", /failed: \[\],\s*\n\s*papers: r\.papers,/.test(route));
check("per-pair rows vẫn giữ shape cũ cho bảng con (symbol + kpi + signals)", /symbol: sym, kpi: r\.kpi, signals: r\.basis, papers: r\.papers/.test(route));

console.log("── 2. Journal component: bare + showSymbol ──");
check("props bare + showSymbol khai báo trong interface", /bare\?: boolean;/.test(journal) && /showSymbol\?: boolean;/.test(journal));
check("signature nhận bare = false, showSymbol = false (mặc định giữ hành vi cũ)", /bare = false, showSymbol = false/.test(journal));
check("nhánh bare render KHÔNG Card wrapper (div + toolbar + table)", /if \(bare\) \{\s*\n\s*return \(\s*\n\s*<div className="space-y-2\.5">/.test(journal));
check("bare vẫn có filter chips + Export CSV (chips + exportCsv trong toolbar chung)", /const toolbar = \(/.test(journal) && journal.includes("onClick={exportCsv}") && journal.includes('t(lang, "journal.csv")'));
check("bare hiển thị đếm lệnh theo filter (journal.count trong nhánh bare)", /bare \? \(\s*\n\s*<span className="text-xs font-semibold text-zinc-300">\s*\n\s*\{t\(lang, "journal\.count"/.test(journal));
check("non-bare giữ nguyên Card wrapper (hồi quy)", /<Card className="border-zinc-800 bg-zinc-900\/60">/.test(journal));
check("showSymbol: cột header dùng key journal.col.symbol", /\{showSymbol && <th className="px-3 py-2 font-medium">\{t\(lang, "journal\.col\.symbol"\)\}<\/th>\}/.test(journal));
check("showSymbol: cell symbol (p.symbol.replace USDT)", /\{showSymbol && \(\s*\n\s*<td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-400">\{p\.symbol\.replace\("USDT", ""\)\}<\/td>/.test(journal));
check("mobile cards cũng có symbol khi showSymbol", /showSymbol && \(\s*\n\s*<span className="font-mono text-\[11px\] font-semibold text-zinc-400">\{p\.symbol\.replace\("USDT", ""\)\}<\/span>/.test(journal));
check("CSV vẫn có cột Symbol (không đổi)", journal.includes('"Symbol,Interval,Side,Leverage,Entry,Entry Time,Exit,Exit Time,Exit Kind,Liquidated,Price Move %,ROE %,Flipped From"'));

console.log("── 3. /stats: Journal nhập vào card Trade journal ──");
check("import Journal component", /import \{ Journal \} from "@\/components\/journal";/.test(stats));
check("state journalPapers + type Paper import", /const \[journalPapers, setJournalPapers\] = useState<Paper\[\] \| null>\(null\);/.test(stats) && /import type \{ Paper \} from "@\/lib\/types";/.test(stats));
check("đường ALL: setJournalPapers(j.papers ?? [])", /setJournalPapers\(j\.papers \?\? \[\]\);/.test(stats));
check("đường ALL lỗi: reset journalPapers(null)", /setJournal\(null\);\s*\n\s*setJournalPer\(null\);\s*\n\s*setJournalPapers\(null\);/.test(stats));
check("đường 1 cặp: setJournalPapers(j ? j.papers : null)", /setJournalPapers\(j \? j\.papers : null\);/.test(stats));
check("Journal render TRONG card journal (sau ChartBox stack — 0.2.82: sau khối tabs terminal, card analysis cũ đã xoá)", (() => {
  const stack = stats.indexOf('kind: "stack"');
  const jr = stats.indexOf("<Journal");
  const tabs = stats.indexOf('<Tabs defaultValue="suggest">');
  return stack > -1 && jr > stack && tabs > -1 && jr > tabs;
})());
check("Journal bare + papers=journalPapers ?? []", /<Journal\s*\n\s*lang=\{lang\}\s*\n\s*papers=\{journalPapers \?\? \[\]\}/.test(stats) && /bare\s*\n\s*showSymbol=\{pickSym === PICK_ALL\}/.test(stats));
check("ALL → showSymbol (cột Symbol khi trộn mọi cặp)", /showSymbol=\{pickSym === PICK_ALL\}/.test(stats));
check("JournalOneResp/JournalAllResp có papers", /type JournalOneResp = \{ kpi: KpiStats; basis: number; papers: Paper\[\] \};/.test(stats) && /papers: Paper\[\];\s*\n\}/.test(stats));
check("chỉ render khi journal đã tải (không hiện bảng trống lúc loading)", /\{journal && \(\s*\n\s*<div className="space-y-2\.5">\s*\n\s*<div className="border-t border-zinc-800\/70 pt-2\.5">/.test(stats));

console.log("── 4. Trang chủ: tab Journal dời hẳn (0.2.82: cả 3 tab còn lại cũng dời — chi tiết ở test-stats-tabs.mts) ──");
check("import Journal đã xoá khỏi trang chủ", !home.includes('from "@/components/journal"') && !home.includes("<Journal"));
check('không còn TabsTrigger value="journal"', !home.includes('value="journal"'));
check('không còn TabsContent value="journal"', !home.includes('<TabsContent value="journal"'));
check('0.2.82: khối 3 tab terminal XOÁ hẳn (suggest dời sang /stats)', !home.includes('defaultValue="suggest"'));
check("0.2.82: tab Context/Wyckoff của rail vẫn nguyên", (() => {
  const seg = home.slice(home.indexOf('<Tabs defaultValue="context"'), home.indexOf("</Tabs>"));
  return seg.includes('value="context"') && seg.includes('value="wyckoff"');
})());

console.log("── 5. FULL WIDTH /stats + /ai ──");
// strip comment (// … và {/* … */}) rồi mới kiểm — chính comment ghi chú "bỏ
// max-w-6xl" từng gây false positive
const noClassMaxW = (src: string) => !/className="[^"]*max-w-6xl/.test(src);
check("/stats: không còn class max-w-6xl", noClassMaxW(stats));
check("/stats: container bỏ mx-auto (full width, giữ padding)", /<div className="space-y-4 p-3 sm:p-5">/.test(stats));
check("/stats: grid section 3 cột trên 2xl", /grid gap-3 md:grid-cols-2 2xl:grid-cols-3/.test(stats));
check("/stats: skeleton khớp grid 3 cột 2xl", stats.split("grid gap-3 md:grid-cols-2 2xl:grid-cols-3").length >= 3);
// 0.2.82: card analysis cũ XOÁ → chỉ còn KPI grid của card journal (lưới
// analysis nay nằm trong tab Analysis qua DeepAnalysis — class riêng của
// component, không phải grid Metric nữa); split 1 lần xuất hiện = 2 phần.
check("/stats: KPI journal giữ 3 cột trên xl (grid analysis cũ đã xoá theo card)", stats.split("grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3").length === 2);
check("/ai: không còn class max-w-6xl (header + body)", noClassMaxW(ai));
check("/ai: header inner full width (flex, không mx-auto)", /<div className="flex flex-wrap items-center gap-2 px-3 py-2\.5 sm:px-5">/.test(ai));
check("/ai: body full width (space-y-4 p-3 sm:p-5)", /<div className="space-y-4 p-3 sm:p-5">/.test(ai));
check("/ai: 2 hàng card xl:grid-cols-2 giữ nguyên (không vỡ bố cục 0.2.76)", (() => {
  const rows = [...ai.matchAll(/grid gap-4 xl:grid-cols-2/g)].map((m) => m.index ?? -1);
  return rows.length === 2;
})());

console.log("── 6. i18n ──");
check('key mới "journal.col.symbol" đủ vi + en (x2)', ((i18n.match(/"journal\.col\.symbol"/g)) ?? []).length === 2);
check('key cũ "tabs.journal" xoá sạch ở cả 2 dict', !i18n.includes('"tabs.journal"'));
// mọi key journal.* + stats.* mà component/trang dùng đều tồn tại ở CẢ HAI dict
const files: [string, string][] = [
  ["journal.tsx", journal],
  ["stats/page.tsx", stats],
  ["page.tsx (terminal tabs)", home],
];
let missing = 0;
for (const [name, src] of files) {
  const used = [...new Set([...src.matchAll(/t\(lang, "((?:journal|tabs|stats)\.[^"]+)"/g)].map((m) => m[1]))];
  for (const k of used) {
    if (!(k in DICTS.vi) || !(k in DICTS.en)) {
      missing++;
      console.log(`    ⚠ ${name}: missing in ${!(k in DICTS.vi) ? "vi" : "en"}: ${k}`);
    }
  }
}
check(`mọi key journal.*/tabs.*/stats.* dùng ở 3 file đều có ở vi+en`, missing === 0, `${missing} thiếu`);

console.log(`\nRESULT journal-stats: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
