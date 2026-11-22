// ─── audit-capital-sync — soi chuỗi vốn + sync Telegram↔panel ở tầng DỮ LIỆU ─
// Chạy trên máy có custom.db (VPS hoặc local):
//
//     bun run scripts/audit-capital-sync.ts
//
// Chỉ ĐỌC — không ghi gì vào DB. Kiểm tra đúng các công thức mà engine
// (closeTradeDirect), autostate (readAutoState) và stats.ts (ledger) đang dùng,
// để trả lời 2 câu hỏi: (1) Telegram và website có đang kể cùng một câu chuyện
// về vốn không, (2) chuỗi capitalBefore/After có đứt gãy ở đâu.
//
// In: per-book chain (anchor → ΣΔ → equity hiện tại), các điểm đứt chuỗi,
// lệnh mở có capitalBefore lệch mốc, bảng BcastVerdict (nguồn gate chung),
// ví DryRunState (hiện đang bị bỏ qua — base hardcode 1000).

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
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

function chainCheck(book: string, rows: Row[], base: number): void {
  const closed = rows
    .filter((r) => r.status === "closed" || r.exitPrice != null)
    .sort((a, b) => +(a.exitTime ?? a.entryTime) - +(b.exitTime ?? b.entryTime));
  const open = rows.filter((r) => !(r.status === "closed" || r.exitPrice != null));

  const deltas: number[] = [];
  const missing: Row[] = [];
  for (const r of closed) {
    if (r.capitalBefore == null || r.capitalAfter == null) { missing.push(r); continue; }
    deltas.push(r2(r.capitalAfter - r.capitalBefore));
  }
  const sum = r2(deltas.reduce((s, x) => s + x, 0));
  const equity = r2(base + sum);

  console.log(`\n${line}\n📖 ${book} — base ${base} · ${closed.length} closed · ${open.length} open`);
  if (closed.length > 0) {
    const first = closed[0];
    console.log(`  anchor đầu sổ: ${first.symbol} cb=${first.capitalBefore ?? "?"} @ ${first.exitTime?.toISOString?.() ?? first.entryTime}`);
    console.log(`  ΣΔ closed = ${sum} → equity (base+ΣΔ) = ${equity}`);
    console.log(`  capitalAfter cuối = ${closed[closed.length - 1].capitalAfter ?? "?"}${closed.length > 1 && closed[closed.length - 1].capitalAfter != null ? ` (lệch base+ΣΔ: ${r2((closed[closed.length - 1].capitalAfter ?? 0) - equity)})` : ""}`);
  }
  if (missing.length > 0) console.log(`  ⚠️ ${missing.length} lệnh closed thiếu capitalBefore/After: ${missing.slice(0, 5).map((m) => m.id.slice(0, 8)).join(", ")}`);

  // đứt chuỗi: capitalAfter của lệnh đóng trước ≠ capitalBefore của lệnh đóng sau
  const prevOk: Array<{ after: number; row: Row }> = [];
  const breaks: string[] = [];
  for (const r of closed) {
    if (r.capitalBefore == null) continue;
    if (prevOk.length > 0) {
      const last = prevOk[prevOk.length - 1];
      if (Math.abs(last.after - r.capitalBefore) > 0.01) {
        breaks.push(`${r.symbol} ${r.side} exit=${r.exitTime?.toISOString?.().slice(0, 16) ?? "?"} cb=${r.capitalBefore} ≠ kỳ vọng ${last.after} (sau ${last.row.symbol} ca=${last.after})`);
      }
    }
    if (r.capitalAfter != null) prevOk.push({ after: r.capitalAfter, row: r });
  }
  console.log(breaks.length === 0 ? "  ✅ chuỗi vốn liền mạch (không đứt)" : `  🔴 ${breaks.length} điểm đứt chuỗi:`);
  for (const b of breaks.slice(0, 12)) console.log(`     • ${b}`);
  if (breaks.length > 12) console.log(`     … +${breaks.length - 12} nữa`);

  if (open.length > 0 && closed.length > 0) {
    const expect = equity;
    for (const o of open) {
      const off = o.capitalBefore != null ? r2(o.capitalBefore - expect) : null;
      console.log(`  🟡 open ${o.symbol} ${o.side} cb=${o.capitalBefore ?? "?"} stake=${o.stakePct ?? "?"}%${off != null && Math.abs(off) > 0.01 ? ` → lệch mốc hiện tại ${expect} (=${off > 0 ? "+" : ""}${off})` : " → khớp mốc hiện tại"}`);
    }
  } else if (open.length > 0) {
    for (const o of open) console.log(`  🟡 open ${o.symbol} ${o.side} cb=${o.capitalBefore ?? "?"} (sổ chưa có lệnh đóng — không đối chiếu được)`);
  }
}

async function main(): Promise<void> {
  console.log(line);
  console.log("AUDIT CAPITAL CHAIN + TG↔PANEL SYNC — dữ liệu thật của máy này");
  console.log(line);

  // ── 1. Từng sổ — cùng công thức engine/autostate/stats ────────────────────
  const bt = await db.autoTrade.findMany({ orderBy: { createdAt: "asc" } });
  chainCheck("AutoTrade (B — sổ engine tự trade, TG AUTO STATS)", bt as unknown as Row[], 1000);

  const vb = await (db as any).vulcanBook.findMany({ orderBy: { createdAt: "asc" } });
  chainCheck("VulcanBook (A — Donchian)", vb as unknown as Row[], 1000);

  const wb = await (db as any).wyckoffBook.findMany({ orderBy: { createdAt: "asc" } });
  chainCheck("WyckoffBook (C)", wb as unknown as Row[], 0);

  const lb = await (db as any).liquidBook.findMany({ orderBy: { createdAt: "asc" } });
  chainCheck("LiquidBook (D)", lb as unknown as Row[], 0);

  const lvb = await (db as any).liveBook.findMany({ orderBy: { createdAt: "asc" } }).catch(() => []);
  chainCheck("LiveBook (E — mirror sàn thật)", lvb as unknown as Row[], 0);

  // ── 2. Ví DryRunState — bị bỏ qua bởi base hardcode 1000 ─────────────────
  const wallet = await (db as any).dryRunState.findUnique({ where: { id: "wallet" } }).catch(() => null);
  console.log(`\n${line}\n👛 DryRunState "wallet" (reset_capital ghi vào đây)`);
  console.log(`  capital=${wallet?.capital ?? "—"} resetAt=${wallet?.resetAt?.toISOString?.() ?? "—"} note=${wallet?.note ?? "—"}`);
  if (wallet?.capital != null && Math.abs(wallet.capital - 1000) > 0.01) {
    console.log(`  🔴 ví ≠ 1000 nhưng engine/autostate/stats đều dùng base 1000 hardcode →`);
    console.log(`     số vốn sau Reset KHÔNG có hiệu lực thật (TG báo "${wallet.capital}" nhưng lệnh kế mở với 1000).`);
  } else {
    console.log(`  ✅ ví = 1000 (hoặc chưa từng reset) — khớp base hardcode, chưa lộ bug.`);
  }

  // ── 3. BcastVerdict — nguồn gate CHUNG panel (web) + engine broadcast ─────
  const bv = await db.bcastVerdict.findMany();
  const pass = bv.filter((b) => b.verdict === "pass");
  const rej = bv.filter((b) => b.verdict === "reject");
  const nowMs = Date.now();
  const fresh24 = bv.filter((b) => nowMs - +new Date(b.at) < 24 * 3_600_000);
  const fresh24Pass = fresh24.filter((b) => b.verdict === "pass" || (b.verdict === "reject" && b.reason.includes("cooldown")));
  const stale = bv.filter((b) => nowMs - +new Date(b.at) > 7 * 86_400_000);
  console.log(`\n${line}\n🚪 BcastVerdict — ${bv.length} dòng (panel web đếm "Gate passed (recent)" từ bảng này)`);
  console.log(`  pass=${pass.length} · reject=${rej.length} · fresh<24h=${fresh24.length} · gatePass(24h, cooldown-aware)=${fresh24Pass.length}`);
  if (bv.length > 0) {
    const newest = bv.reduce((a, b) => (+new Date(a.at) > +new Date(b.at) ? a : b));
    console.log(`  lần chấm mới nhất: ${newest.symbol} ${newest.interval} ${newest.verdict} @ ${new new Date(newest.at).toISOString().slice(0, 16)}Z (${Math.round((nowMs - +new Date(newest.at)) / 60000)} phút trước)`);
  }
  if (stale.length > 0) console.log(`  ⚠️ ${stale.length} dòng cứng cũ >7 ngày (không được chấm lại): ${stale.slice(0, 8).map((s) => `${s.symbol}/${s.interval.slice(0, 3)}`).join(", ")}`);
  if (pass.length > 0) console.log(`  pass gần nhất: ${pass.slice(-8).map((p) => `${p.symbol} ${p.interval}`).join(" · ")}`);

  // ── 4. Tổng hợp theo cách stats.ts tính (so telegram nếu cần) ─────────────
  const sumOf = (rows: Row[]): number =>
    r2(rows.filter((r) => r.status === "closed" || r.exitPrice != null)
      .reduce((s, r) => s + (r.capitalAfter != null && r.capitalBefore != null ? r.capitalAfter - r.capitalBefore : 0), 0));
  const closedAll = sumOf(bt as unknown as Row[]) + sumOf(vb as unknown as Row[]) + sumOf(wb as unknown as Row[]) + sumOf(lb as unknown as Row[]) + sumOf(lvb as unknown as Row[]);
  console.log(`\n${line}\n🧮 LEDGER WEBSITE (stats.ts): totalStart=2000`);
  console.log(`  Σ closed tất cả sổ = ${closedAll} → totalEquity (chưa tính open unrealized) = ${r2(2000 + closedAll)}`);
  console.log(`  Equity card & TG AUTO STATS cùng đọc st0.capital = ${r2(1000 + sumOf(bt as unknown as Row[]))} (chỉ sổ B)`);
  console.log(`\n${line}\nXONG — chỉ đọc, không ghi gì. Đối chiếu với tin Telegram gần nhất để thấy sync.`);
}

main()
  .catch((e) => { console.error("audit lỗi:", e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
