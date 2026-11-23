// ─── audit-capital-sync — soi chuỗi vốn + sync Telegram↔panel ở tầng DỮ LIỆU ─
// Chạy trên máy có custom.db (VPS hoặc local):
//
//     node scripts/audit-capital-sync.ts          (hoặc: bun run scripts/audit-capital-sync.ts)
//     npm run audit:capital
//     node scripts/audit-capital-sync.ts --selftest   (tự kiểm detector — không cần DB)
//
// Chỉ ĐỌC — không ghi gì vào DB. Kiểm tra đúng các công thức mà engine
// (closeTradeDirect), autostate (readAutoState) và stats.ts (ledger) đang dùng,
// để trả lời 2 câu hỏi: (1) Telegram và website có đang kể cùng một câu chuyện
// về vốn không, (2) chuỗi capitalBefore/After có đứt gãy ở đâu.
//
// BẤT BIẾN chuỗi vốn: capitalBefore là vốn TẠI THỜI ĐIỂM MỞ lệnh (engine ghi
// lúc open), capitalAfter = capitalBefore + delta của chính lệnh đó. Sổ có
// chồng vị thế (nhiều lệnh chạy song song) thì chuỗi tuần tự "ca lệnh trước =
// cb lệnh sau" TỰ NHIÊN KHÔNG LIỀN — không phải đứt (bản audit đầu đã báo
// động giả 48 "đứt" trên sổ B vì soi nhầm bất biến này). Detector soi:
//   (1) cb mỗi lệnh ≈ base + Σ pnl đã chốt trước lúc MỞ lệnh (cho cùng tick +2s)
//   (2) ca = cb + cb×stake%×pnl% đúng công thức closeTradeDirect từng lệnh
//   (3) lệnh mở khớp vốn-lúc-mở (không so với equity hiện tại)
//   (4) BcastVerdict + ví DryRunState (base wallet-aware từ 0.2.86 + fix ledger)

import { PrismaClient } from "@prisma/client";

const line = "─".repeat(64);
const r2 = (x: number): number => Math.round(x * 100) / 100;

type Row = {
  id: string; symbol: string; side: string; status: string;
  entryPrice: number; exitPrice: number | null;
  entryTime: Date; exitTime: Date | null;
  pnlPct: number | null; roePct?: number | null;
  capitalBefore: number | null; capitalAfter: number | null;
  stakePct?: number | null; exitKind?: string | null;
};

// ── phân tích chuỗi vốn của một sổ (pure — không đụng DB, selftest chạy lại) ──
export type ChainReport = {
  closed: number;
  open: number;
  sumDelta: number;
  equity: number;
  anchor: { symbol: string; cb: number; at: Date } | null;
  missing: number;
  overlapRows: number;
  realBreaks: string[];
  integrityBad: string[];
  openRows: Array<{ symbol: string; side: string; stakePct: number | null; cb: number | null; expect: number; banked: number; ok: boolean }>;
  lastCa: number | null;
  lastCaIsEquity: boolean;
};

// vốn tại thời điểm mở lệnh = base + Σ pnl các lệnh đã đóng với exitTime ≤ entry (+slackMs)
function capAtEntry(
  closed: Array<{ exitTime: Date | null; entryTime: Date; delta: number | null }>,
  entry: Date,
  base: number,
  slackMs: number,
): number {
  const t = +entry + slackMs;
  return r2(base + closed.reduce((s, c) => s + (c.delta != null && +(c.exitTime ?? c.entryTime) <= t ? c.delta : 0), 0));
}

export function analyzeChain(rows: Row[], base: number): ChainReport {
  const closed = rows
    .filter((r) => r.status === "closed" || r.exitPrice != null)
    .sort((a, b) => +(a.exitTime ?? a.entryTime) - +(b.exitTime ?? b.entryTime));
  const open = rows.filter((r) => !(r.status === "closed" || r.exitPrice != null));

  const deltas = new Map<string, number | null>();
  let missing = 0;
  for (const r of closed) {
    if (r.capitalBefore == null || r.capitalAfter == null) { missing++; deltas.set(r.id, null); continue; }
    deltas.set(r.id, r2(r.capitalAfter - r.capitalBefore));
  }
  const sum = r2([...deltas.values()].reduce((s, x) => s + (x ?? 0), 0));
  const equity = r2(base + sum);

  const rep: ChainReport = {
    closed: closed.length,
    open: open.length,
    sumDelta: sum,
    equity,
    anchor: closed.length > 0 ? { symbol: closed[0].symbol, cb: closed[0].capitalBefore ?? 0, at: closed[0].exitTime ?? closed[0].entryTime } : null,
    missing,
    overlapRows: 0,
    realBreaks: [],
    integrityBad: [],
    openRows: [],
    lastCa: closed.length > 0 ? closed[closed.length - 1].capitalAfter ?? null : null,
    lastCaIsEquity: false,
  };

  const closedLite = closed.map((r) => ({ exitTime: r.exitTime, entryTime: r.entryTime, delta: deltas.get(r.id) ?? null }));

  // (1) cb mỗi lệnh (đã đóng + đang mở) ≈ vốn tại lúc MỞ lệnh
  for (const r of [...closed, ...open]) {
    if (r.capitalBefore == null) continue;
    const isClosed = r.status === "closed" || r.exitPrice != null;
    if (closed.some((o) => o.id !== r.id && o.exitTime != null && +o.entryTime < +r.entryTime && +o.exitTime > +r.entryTime)) rep.overlapRows++;
    let expect = capAtEntry(closedLite, r.entryTime, base, 0);
    let ok = Math.abs(r.capitalBefore - expect) <= 0.01;
    if (!ok) {
      const alt = capAtEntry(closedLite, r.entryTime, base, 2_000); // đóng/mở cùng tick
      if (Math.abs(r.capitalBefore - alt) <= 0.01) { ok = true; expect = alt; }
    }
    if (!ok) rep.realBreaks.push(`${r.symbol} ${r.side} [${isClosed ? "closed" : "open"}] entry=${r.entryTime.toISOString().slice(0, 16)} cb=${r.capitalBefore} ≠ vốn-lúc-mở ${expect}`);
    if (!isClosed) rep.openRows.push({ symbol: r.symbol, side: r.side, stakePct: r.stakePct ?? null, cb: r.capitalBefore, expect, banked: r2(equity - r.capitalBefore), ok });
  }

  // (2) toàn vẹn từng lệnh đã đóng: ca = cb + cb×stake%×pnl% (đúng công thức closeTradeDirect:523)
  for (const r of closed) {
    if (r.capitalBefore == null || r.capitalAfter == null || r.pnlPct == null) continue;
    const stake = r.stakePct ?? 100;
    const delta = Math.round(r.capitalBefore * (stake / 100) * (r.pnlPct / 100) * 100) / 100;
    const expectCa = Math.max(0, Math.round((r.capitalBefore + delta) * 100) / 100);
    if (Math.abs(expectCa - r.capitalAfter) > 0.011) {
      rep.integrityBad.push(`${r.symbol} exit=${(r.exitTime ?? r.entryTime).toISOString().slice(0, 16)} ca=${r.capitalAfter} ≠ cb+stake%×pnl%=${expectCa}`);
    }
  }

  // ca cuối chỉ = equity khi sổ tuần tự thuần (không chồng, không thiếu, không đứt)
  rep.lastCaIsEquity = closed.length > 0 && rep.overlapRows === 0 && rep.realBreaks.length === 0 && missing === 0;
  return rep;
}

function chainCheck(book: string, rows: Row[], base: number): void {
  const rep = analyzeChain(rows, base);
  console.log(`\n${line}\n📖 ${book} — base ${base} · ${rep.closed} closed · ${rep.open} open`);
  if (rep.closed > 0 && rep.anchor) {
    console.log(`  anchor đầu sổ: ${rep.anchor.symbol} cb=${rep.anchor.cb} @ ${rep.anchor.at.toISOString().slice(0, 16)}`);
    console.log(`  ΣΔ closed = ${rep.sumDelta} → equity (base+ΣΔ) = ${rep.equity}`);
    console.log(`  capitalAfter cuối = ${rep.lastCa ?? "?"}${rep.lastCa != null ? (rep.lastCaIsEquity ? " (= equity — sổ tuần tự thuần)" : ` (riêng của lệnh cuối — sổ có chồng vị thế; equity nhìn ΣΔ = ${rep.equity})`) : ""}`);
  }
  if (rep.missing > 0) console.log(`  ⚠️ ${rep.missing} lệnh closed thiếu capitalBefore/After — không tính vào ΣΔ`);
  if (rep.overlapRows > 0) console.log(`  ↩️ ${rep.overlapRows} lệnh chạy trong khoảng chồng vị thế — chuỗi tuần tự "ca trước = cb sau" KHÔNG áp dụng; đối chiếu đúng: cb mỗi lệnh ≈ vốn tại lúc MỞ lệnh`);
  console.log(rep.realBreaks.length === 0 ? "  ✅ chuỗi vốn theo capital-lúc-mở: liền mạch" : `  🔴 ${rep.realBreaks.length} lệnh cb lệch vốn-lúc-mở (đứt thật):`);
  for (const b of rep.realBreaks.slice(0, 12)) console.log(`     • ${b}`);
  if (rep.realBreaks.length > 12) console.log(`     … +${rep.realBreaks.length - 12} nữa`);
  console.log(rep.integrityBad.length === 0 ? "  ✅ công thức từng lệnh (ca = cb + cb×stake%×pnl%): đúng toàn bộ" : `  🔴 ${rep.integrityBad.length} lệnh ca ≠ cb+stake%×pnl% (sai số gốc):`);
  for (const b of rep.integrityBad.slice(0, 8)) console.log(`     • ${b}`);
  for (const o of rep.openRows) {
    console.log(`  ${o.ok ? "✅" : "🔴"} open ${o.symbol} ${o.side} cb=${o.cb ?? "?"} stake=${o.stakePct ?? "?"}%${o.ok ? ` = vốn lúc mở ${o.expect} (sau đó sổ đã chốt thêm ${o.banked >= 0 ? "+" : ""}${o.banked} → equity ${rep.equity})` : ` ≠ vốn lúc mở ${o.expect}`}`);
  }
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    console.log(line);
    console.log("AUDIT CAPITAL CHAIN + TG↔PANEL SYNC — dữ liệu thật của máy này");
    console.log(line);

    // ── 0. Ví DryRunState — base của sổ AutoTrade (wallet-aware 0.2.86+) ──
    const wallet = await (db as any).dryRunState.findUnique({ where: { id: "wallet" } }).catch(() => null);
    const bBase = wallet?.capital != null && wallet.capital > 0 ? Number(wallet.capital) : 1000;
    console.log(`\n${line}\n👛 DryRunState "wallet" — base sổ AutoTrade = ${bBase}`);
    console.log(`  capital=${wallet?.capital ?? "—"} resetAt=${wallet?.resetAt?.toISOString?.() ?? "—"} note=${wallet?.note ?? "—"}`);
    if (wallet?.capital == null || wallet.capital <= 0) console.log(`  ⚠️ ví rỗng/0 — đang fallback base 1000 (autostate cũng vậy)`);

    // ── 1. Từng sổ — cùng công thức engine/autostate/stats ────────────────
    const bt = await db.autoTrade.findMany({ orderBy: { createdAt: "asc" } });
    chainCheck("AutoTrade (B — sổ engine tự trade, TG AUTO STATS)", bt as unknown as Row[], bBase);

    const vb = await (db as any).vulcanBook.findMany({ orderBy: { createdAt: "asc" } });
    chainCheck("VulcanBook (A — Donchian)", vb as unknown as Row[], 1000);

    const wb = await (db as any).wyckoffBook.findMany({ orderBy: { createdAt: "asc" } });
    chainCheck("WyckoffBook (C)", wb as unknown as Row[], 0);

    const lb = await (db as any).liquidBook.findMany({ orderBy: { createdAt: "asc" } });
    chainCheck("LiquidBook (D)", lb as unknown as Row[], 0);

    const lvb = await (db as any).liveBook.findMany({ orderBy: { createdAt: "asc" } }).catch(() => []);
    chainCheck("LiveBook (E — mirror sàn thật)", lvb as unknown as Row[], 0);

    // ── 2. BcastVerdict — nguồn gate CHUNG panel (web) + engine broadcast ──
    const bv = await db.bcastVerdict.findMany();
    const pass = bv.filter((b) => b.verdict === "pass");
    const rej = bv.filter((b) => b.verdict === "reject");
    const nowMs = Date.now();
    const fresh24 = bv.filter((b) => nowMs - +new Date(b.at) < 24 * 3_600_000);
    const fresh24Pass = fresh24.filter((b) => b.verdict === "pass" || (b.verdict === "reject" && b.reason.includes("cooldown")));
    const stale = bv.filter((b) => nowMs - +new Date(b.at) > 7 * 86_400_000);
    console.log(`\n${line}\n🚪 BcastVerdict — ${bv.length} dòng (panel web đếm "Gate passed (recent)" từ bảng này)`);
    console.log(`  pass=${pass.length} · reject=${rej.length} · fresh<24h=${fresh24.length} · gatePass(24h, cooldown-aware)=${fresh24Pass.length}`);
    const newest = bv.length > 0 ? bv.reduce((a, b) => (+new Date(a.at) > +new Date(b.at) ? a : b)) : null;
    if (newest) {
      console.log(`  lần chấm mới nhất: ${newest.symbol} ${newest.interval} ${newest.verdict} @ ${new Date(newest.at).toISOString().slice(0, 16)}Z (${Math.round((nowMs - +new Date(newest.at)) / 60000)} phút trước)`);
      if (pass.length === 0) console.log(`  ℹ️ pass=0 — các dòng hiện có đều chấm TRƯỚC khi fix ghi-verdicts lên ngôi. Chờ tick broadcast 5 phút sau restart rồi chạy lại: vẫn 0 → gate thật sự chưa cho câu nào qua (DQF/cooldown), không phải mất dữ liệu.`);
    }
    if (stale.length > 0) console.log(`  ⚠️ ${stale.length} dòng cứng cũ >7 ngày (không được chấm lại): ${stale.slice(0, 8).map((s) => `${s.symbol}/${s.interval.slice(0, 3)}`).join(", ")}`);
    if (pass.length > 0) console.log(`  pass gần nhất: ${pass.slice(-8).map((p) => `${p.symbol} ${p.interval}`).join(" · ")}`);

    // ── 3. Tổng hợp theo cách stats.ts tính (so telegram nếu cần) ─────────
    const sumOf = (rows: Row[]): number =>
      r2(rows.filter((r) => r.status === "closed" || r.exitPrice != null)
        .reduce((s, r) => s + (r.capitalAfter != null && r.capitalBefore != null ? r.capitalAfter - r.capitalBefore : 0), 0));
    const closedAll = sumOf(bt as unknown as Row[]) + sumOf(vb as unknown as Row[]) + sumOf(wb as unknown as Row[]) + sumOf(lb as unknown as Row[]) + sumOf(lvb as unknown as Row[]);
    console.log(`\n${line}\n🧮 LEDGER WEBSITE (stats.ts): totalStart=2000`);
    console.log(`  Σ closed tất cả sổ = ${closedAll} → totalEquity (chưa tính open unrealized) = ${r2(2000 + closedAll)}`);
    console.log(`  Equity card & TG AUTO STATS cùng đọc st0.capital = ${r2(bBase + sumOf(bt as unknown as Row[]))} (chỉ sổ B, base = ví ${bBase})`);
    console.log(`\n${line}\nXONG — chỉ đọc, không ghi gì. Đối chiếu với tin Telegram gần nhất để thấy sync.`);
  } finally {
    await db.$disconnect();
  }
}

// ─── selftest — node scripts/audit-capital-sync.ts --selftest (không cần DB) ──
function runSelftest(): void {
  console.log(`${line}\nSELFTEST analyzeChain — không đụng DB\n${line}`);
  let fails = 0;
  const T = (h: number, s = 0) => new Date(Date.UTC(2026, 10, 20, h, 0, s));
  const mk = (id: string, symbol: string, side: string, entryH: number, exitH: number | null, cb: number | null, ca: number | null, pnl: number | null, stake = 10): Row => ({
    id, symbol, side, status: exitH == null ? "open" : "closed",
    entryPrice: 1, exitPrice: exitH == null ? null : 1,
    entryTime: T(entryH), exitTime: exitH == null ? null : T(exitH),
    pnlPct: pnl, capitalBefore: cb, capitalAfter: ca, stakePct: stake,
  });
  const check = (name: string, cond: boolean, detail = "") => {
    console.log(`  ${cond ? "PASS" : "FAIL"} — ${name}${cond || !detail ? "" : ` → ${detail}`}`);
    if (!cond) fails++;
  };

  // S1 — sổ tuần tự thuần: ca trước = cb sau, không chồng vị thế
  const s1 = [
    mk("a", "AAAUSDT", "LONG", 0, 4, 1000, 1010, 10),
    mk("b", "BBBUSDT", "LONG", 5, 9, 1010, 1004.95, -5),
  ];
  const r1 = analyzeChain(s1, 1000);
  check("S1 tuần tự — 0 đứt", r1.realBreaks.length === 0, JSON.stringify(r1.realBreaks));
  check("S1 tuần tự — công thức từng lệnh đúng", r1.integrityBad.length === 0, JSON.stringify(r1.integrityBad));
  check("S1 — ca cuối = equity (sổ thuần)", r1.lastCaIsEquity === true);
  check("S1 — equity = base+ΣΔ = 1004.95", r1.equity === 1004.95);

  // S2 — chồng vị thế (đúng cấu trúc sổ B thật): detector tuần tự sẽ báo 3 "đứt" giả
  const s2 = [
    mk("x", "XXXUSDT", "LONG", 0, 4, 1000, 1003.48, 3.48),
    mk("y", "YYYUSDT", "LONG", 1, 6, 1000, 1001.68, 8.4, 2),
    mk("z", "ZZZUSDT", "SHORT", 5, 8, 1003.48, 1001.68, -1.79),
    mk("w", "WWWUSDT", "LONG", 7, 9, 1005.16, 1004.05, -5.5, 2),
  ];
  const r2s = analyzeChain(s2, 1000);
  check("S2 chồng vị thế — 0 đứt thật (soi tuần tự sẽ báo 3)", r2s.realBreaks.length === 0, JSON.stringify(r2s.realBreaks));
  check("S2 — phát hiện 3 lệnh chồng", r2s.overlapRows === 3);
  check("S2 — công thức từng lệnh đúng", r2s.integrityBad.length === 0, JSON.stringify(r2s.integrityBad));
  check("S2 — ca cuối KHÔNG phải equity", r2s.lastCaIsEquity === false);
  check("S2 — equity = base+ΣΔ = 1002.25", r2s.equity === 1002.25);

  // S3 — mất pnl thật: cb lệnh sau thiếu phần lệnh trước đã chốt
  const s3 = [
    mk("a", "AAAUSDT", "LONG", 0, 4, 1000, 1010, 10),
    mk("b", "BBBUSDT", "LONG", 5, 9, 1005, 999.98, -5),
  ];
  const r3 = analyzeChain(s3, 1000);
  check("S3 mất pnl — báo 1 đứt thật", r3.realBreaks.length === 1, JSON.stringify(r3.realBreaks));
  check("S3 — công thức từng lệnh vẫn đúng", r3.integrityBad.length === 0, JSON.stringify(r3.integrityBad));

  // S4 — ca sai so với công thức (sai số gốc từng lệnh)
  const s4 = [mk("a", "AAAUSDT", "LONG", 0, 4, 1000, 1003.48, 10)]; // đúng ca phải 1010
  const r4 = analyzeChain(s4, 1000);
  check("S4 ca lệch công thức — báo 1 lỗi", r4.integrityBad.length === 1, JSON.stringify(r4.integrityBad));
  check("S4 — không nghi đứt chuỗi", r4.realBreaks.length === 0);

  // S5 — lệnh mở lệch vốn-lúc-mở (không so với equity hiện tại)
  const s5 = [
    mk("a", "AAAUSDT", "LONG", 0, 4, 1000, 1010, 10),
    mk("o", "OOPUSDT", "SHORT", 5, null, 1005, null, null),
  ];
  const r5 = analyzeChain(s5, 1000);
  check("S5 open lệch vốn lúc mở — ok=false", r5.openRows.length === 1 && r5.openRows[0].ok === false);
  check("S5 — đứt thật tính cả lệnh mở", r5.realBreaks.length === 1, JSON.stringify(r5.realBreaks));

  // S6 — đóng/mở cùng tick (mở trước, lệnh kia đóng +1s): khớp cửa sổ +2s
  const s6 = [
    mk("a", "AAAUSDT", "LONG", 0, 4, 1000, 1010, 10),
  ];
  s6[0].exitTime = T(4, 1);
  s6.push(mk("o", "OOPUSDT", "LONG", 4, 8, 1010, 1004.95, -5));
  const r6 = analyzeChain(s6, 1000);
  check("S6 cùng tick (+1s) — 0 đứt", r6.realBreaks.length === 0, JSON.stringify(r6.realBreaks));

  console.log(fails === 0 ? `\n${line}\nSELFTEST: tất cả PASS` : `\n${line}\nSELFTEST: ${fails} FAIL`);
  if (fails > 0) process.exitCode = 1;
}

if (process.argv.includes("--selftest")) runSelftest();
else main().catch((e) => { console.error("audit lỗi:", e); process.exitCode = 1; });
