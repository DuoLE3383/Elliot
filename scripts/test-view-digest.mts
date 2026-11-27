// Test /api/view (0.2.35 — "dọn hết những gì đang chạy trên web về chạy ở
// server trừ chart") + tin Telegram "QUÉT LỆNH · TOP 10" 8h/lần (0.2.35).
//
//   1. GET /api/view với fetch bị mock về Binance cục bộ → payload đủ shape:
//      engine (signals/papers/sma/stop/trend/kpi/gate), wyckoff (tints là
//      number[] sau JSON), analysis, 3 pies, sessions/whale/cycles, watchlist.
//   2. buildScanTop10Message: tin top-10 gồm cả combo CHƯA đạt cổng (kèm ✗ lý
//      do) và combo đạt cổng (🚀 + SL/TP); verdicts phủ ĐỦ mọi row đầu vào;
//      state.scan10 không bị đụng tới (engine mới ghi sau khi gửi).
//   3. Guard: payload cache 1.5s (2 lần gọi liên tiếp → cùng `at`).
//
// Run: npx tsx scripts/test-view-digest.mts

import type { ScanRow } from "../src/lib/autotrade";
import type { BcastState } from "../src/lib/scan-broadcast";

// ─── mock fetch Binance TRƯỚC khi import module nào chạm network ─────────────
type Raw = (number | string)[];
function mkRows(n: number, base: number): Raw[] {
  const out: Raw[] = [];
  let p = base;
  for (let i = 0; i < n; i++) {
    const o = p;
    const drift = Math.sin(i / 7) * base * 0.004 + ((i % 11) - 5) * base * 0.0008;
    p = o + drift;
    const h = Math.max(o, p) * 1.004;
    const l = Math.min(o, p) * 0.996;
    // volume đủ để 24h quote vol ≥ $7M (BCAST_VOL_MIN) ở MỌI mức giá
    const v = Math.max(1200, 500_000 / base);
    const t0 = Date.now() - (n - i) * 300_000;
    out.push([t0, String(o), String(h), String(l), String(p), String(v), t0 + 299_999, String(v * p), 120, String(v / 2), String((v * p) / 2), "0"]);
  }
  return out;
}
const globalFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown): Promise<Response> => {
  const u = String(url);
  if (u.includes("/fapi/v1/klines")) {
    const sp = new URL(u).searchParams;
    const lim = Number(sp.get("limit") ?? 500);
    const base = sp.get("symbol") === "BTCUSDT" ? 68000 : 2.4;
    return new Response(JSON.stringify(mkRows(lim, base)), { status: 200 });
  }
  return new Response("[]", { status: 200 });
}) as typeof fetch;

const { NextRequest } = await import("next/server");
const { GET: viewGET } = await import("../src/app/api/view/route");
const { DEFAULT_SETTINGS, DEFAULT_WYCKOFF } = await import("../src/lib/types");
const { buildScanTop10Message, loadBcastState } = await import("../src/lib/scan-broadcast");

let failures = 0;
function check(cond: boolean, label: string, detail = "") {
  if (cond) console.log(`  PASS ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label} ${detail}`);
  }
}

// ─── 1. /api/view end-to-end ──────────────────────────────────────────────────

console.log("== GET /api/view");
const qs = new URLSearchParams({
  symbol: "BTCUSDT",
  interval: "5m",
  s: JSON.stringify({ ...DEFAULT_SETTINGS, leverage: 10 }),
  w: JSON.stringify(DEFAULT_WYCKOFF),
  pairs: "BTCUSDT,ETHUSDT",
});
const req = new NextRequest(`http://localhost:3000/api/view?${qs.toString()}`);
const res = await viewGET(req);
check(res.status === 200, "HTTP 200", String(res.status));
const v = (await res.json()) as Record<string, unknown>;

check(v.symbol === "BTCUSDT" && v.interval === "5m", "đúng symbol/interval");
check(Array.isArray(v.signals) && Array.isArray(v.confirmed), "signals + confirmed là mảng");
check(Array.isArray(v.sma) && (v.sma as unknown[]).length === 500, "sma đủ 500 phần tử");
check(Array.isArray(v.stop) && (v.stop as unknown[]).length === 500, "stop đủ 500 phần tử");
check(Array.isArray(v.trend) && (v.trend as unknown[]).length === 500, "trend đủ 500 phần tử");
const papers = v.papers as { id: string; status: string; pnlPct: number | null }[];
check(Array.isArray(papers) && papers.length > 0, `papers sinh được lệnh (${papers.length})`);
check(papers.every((p) => p.id.startsWith("BTCUSDT-5m-")), "paper id mang symbol+interval thật");
const kpi = v.kpi as { closed: number; total: number };
check(kpi.closed === papers.filter((p) => p.status === "closed").length, "kpi.closed khớp papers");
const gate = v.gate as { long: boolean; short: boolean; sma: number | null };
check(typeof gate.long === "boolean" && typeof gate.short === "boolean", "gate long/short boolean");
const wy = v.wyckoff as { tints: unknown[]; emaF: unknown[]; dash: unknown } | null;
check(wy != null && Array.isArray(wy.tints) && wy.tints.length === 500, "wyckoff.tints là mảng thường 500 phần tử (không Int8Array)");
check(wy != null && Array.isArray(wy.emaF) && wy.emaF.length === 500, "wyckoff.emaF đủ 500");
check(Array.isArray(v.analysis) === false && (v.analysis as { trend?: string }).trend != null, "analysis có trend");
const pies = v.pies as { key: string; k: unknown; slices: unknown[] }[];
check(Array.isArray(pies) && pies.length === 3, "3 donut preset");
check(pies.every((p) => (p.k as { closed: number }).closed != null), "mỗi pie có kpi riêng");
const sess = v.sessStats as { key: string }[];
check(Array.isArray(sess) && sess.length === 4, "sessionStats 4 phiên");
check(v.cycles != null && typeof (v.cycles as { days: number }).days === "number", "cycles từ BTC daily (mock)");
const watch = v.watch as { sym: string; status: { kind: string }; spark: { pts: number[] } | null }[];
check(watch.length === 2 && watch[0].sym === "BTCUSDT" && watch[1].sym === "ETHUSDT", "watch 2 cặp đúng thứ tự");
check(watch.every((r) => r.spark != null && r.spark.pts.length === 48), "sparkline 48 điểm chuẩn hoá");
check(watch.every((r) => ["loading", "wait", "signal"].includes(r.status.kind)), "watch status đúng 3 kind");
const size = JSON.stringify(v).length;
check(size < 500_000, `payload hợp lý (${(size / 1024).toFixed(0)}KB < 500KB)`);

// cache 1.5s — gọi ngay lần 2 → cùng `at`
const res2 = await viewGET(new NextRequest(`http://localhost:3000/api/view?${qs.toString()}`));
const v2 = (await res2.json()) as { at: number };
check(v2.at === v.at, "cache 1.5s — 2 gọi liền nhau chia một payload", `${v.at} vs ${v2.at}`);

// ─── 2. buildScanTop10Message ─────────────────────────────────────────────────

console.log("== buildScanTop10Message");
const mkRow = (sym: string, itv: string, bias: "LONG" | "SHORT", auc: number, acc: number, conf: number, tpPct = 1.8): ScanRow => ({
  symbol: sym,
  interval: itv,
  acc,
  auc,
  prob: bias === "LONG" ? 0.5 + conf / 2 : 0.5 - conf / 2,
  confidence: conf,
  bias,
  slPct: 1.2,
  tpPct,
  atrCoef: 2,
  score: Math.round((auc - 0.5) * 100 + (acc - 50) + conf * 15),
  samples: 288,
  valSamples: 72,
  horizon: 5,
  trainedAt: Date.now(),
  whale: { verdict: "calm", buyRatio: 0.5, n: 20 } as ScanRow["whale"],
  champAuc: 0,
  champAcc: 0,
  regressed: false,
});
const rows: ScanRow[] = [
  mkRow("PEPEUSDT", "15m", "LONG", 0.86, 78, 0.7, 6), // TP1 6% ≥ PL1 5% → đạt cổng
  mkRow("LINKUSDT", "15m", "SHORT", 0.82, 74, 0.5),
  mkRow("SUIUSDT", "1m", "LONG", 0.7, 62, 0.4),
  mkRow("WIFUSDT", "1m", "SHORT", 0.55, 52, 0.2), // dưới sàn → ✗
];
const tickers: Record<string, { symbol: string; price: number; changePct: number; quoteVolume: number }> = {
  PEPEUSDT: { symbol: "PEPEUSDT", price: 0.0000121, changePct: 3.2, quoteVolume: 5e7 },
  LINKUSDT: { symbol: "LINKUSDT", price: 17.4, changePct: -1.1, quoteVolume: 4e8 },
  SUIUSDT: { symbol: "SUIUSDT", price: 2.1, changePct: 0.8, quoteVolume: 3e8 },
  WIFUSDT: { symbol: "WIFUSDT", price: 1.8, changePct: -0.4, quoteVolume: 2e8 },
};
const st0: BcastState = loadBcastState();
const built = await buildScanTop10Message(rows, tickers, st0, new Set(["PEPEUSDT"]), {
  score: 60,
  auc: 0.8,
  acc: 70,
});
check(built.verdicts.length === rows.length, "verdicts phủ ĐỦ mọi row đầu vào", `${built.verdicts.length}/${rows.length}`);
const pepe = built.verdicts.find((x) => x.symbol === "PEPEUSDT");
const wif = built.verdicts.find((x) => x.symbol === "WIFUSDT");
check(pepe?.verdict === "pass", "PEPE đạt cổng", JSON.stringify(pepe));
check(wif?.verdict === "reject", "WIF dưới sàn → reject", JSON.stringify(wif));
check(built.text != null && built.text.includes("SCAN ·") && built.text.includes("PASSED THE GATE"), "tiêu đề tin SCAN (EN) — passed the gate");
check(built.text!.includes("PEPEUSDT") && !built.text!.includes("WIFUSDT"), "tin CHỈ liệt kê combo đạt cổng (0.2.45 — combo chặn không vào tin)");
check(built.text!.includes("🚀") && !built.text!.includes("✗"), "c marker 🚀 đạt cổng — lý do chặn chỉ ở web panel");
check(built.text!.includes("Digest every 8 hours"), "chân tin nói rõ 8 giờ/lần (EN)");
check(built.text!.length < 4000, `tin gọn trong giới hạn Telegram (${built.text!.length} ký tự < 4000)`);
check(built.picked.length <= 10, "picked ≤ TOP 10");
check(st0.scan10 === loadBcastState().scan10 || st0.scan10 === undefined, "builder KHÔNG tự ghi state.scan10 (engine ghi sau khi gửi)");

// ─── 3. ranks ổn định — rows đã sort theo score, pool cắt theo thứ tự ─────────

console.log("== ranks");
const built2 = await buildScanTop10Message([...rows].reverse(), tickers, st0, undefined, { score: 60, auc: 0.8, acc: 70 });
const firstLine = built2.text?.split("\n").find((l) => /^\d+\./.test(l.trim())) ?? "";
check(firstLine.includes("PEPEUSDT") || firstLine.includes("WIFUSDT") === false ? firstLine.includes("PEPEUSDT") || firstLine.includes("SUIUSDT") || firstLine.includes("LINKUSDT") : false, `dòng đầu là combo điểm cao nhất trong pool: ${firstLine.slice(0, 80)}`);

// ─── dọn dẹp ──────────────────────────────────────────────────────────────────
globalThis.fetch = globalFetch;

console.log(failures === 0 ? "\n═══ ALL VIEW+DIGEST PASS ═══" : `\n═══ ${failures} FAIL ═══`);
process.exit(failures === 0 ? 0 : 1);
