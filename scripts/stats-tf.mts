// ─── stats-tf — gross P&L / PHÍ / số lệnh theo KHUNG GIỜ + calibration ────────
// Audit 04/11: "Break your results down by timeframe, with fees and funding
// separated out. If you can send gross P&L, fees, and trade counts per
// timeframe, I can tell you which timeframes to keep." + "Compare the live
// hit rate to predicted probability bucket by bucket (calibration)."
//
// Chạy trên MÁY CÓ DB (VPS: cd /opt/elliott && npx tsx scripts/stats-tf.mts;
// local: bash scripts/sync-db-from-vps.sh trước rồi chạy như trên). Toán thuần
// nằm ở src/lib/tf-stats.ts (đã test đối chứng tay); script này chỉ nạp DB.
//
// GROSS/NET tính lại từ GIÁ (đồng nhất mọi phiên bản — lệnh trước 0.2.77 lưu
// pnlPct gross, sau đó net; DB Σ chỉ in làm đối chiếu chéo). Phí = feeRoe
// (FEE_PCT runtime — hydrate từ db/params-override.json như engine). Funding
// KHÔNG có trong dry-run → in ƯỚC TÍNH riêng @ 0.01%/8h (baseline Binance),
// không trộn vào cột phí.

import fs from "node:fs";
import path from "node:path";

// .env thắng env kế thừa — đúng DB app đang dùng (giống db-doctor.ts)
try {
  const envText = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* không có .env — dùng env mặc định */
}

// hydrate override runtime (FEE_PCT...) như engine — fail-open khi thiếu file
try {
  const { hydrateParams } = await import("../src/lib/params-store");
  hydrateParams();
} catch {
  /* chưa có params-override.json — dùng mặc định params.ts */
}

const { db } = await import("../src/lib/db");
const { tfBreakdown, tfTotal, calibrationBuckets } = await import("../src/lib/tf-stats");
const { FEE_PCT } = await import("../src/lib/params");

type DbRow = {
  symbol: string;
  interval: string;
  side: string;
  entryPrice: number;
  exitPrice: number | null;
  leverage: number;
  stakePct: number | null;
  prob: number | null;
  pnlPct: number | null;
  exitKind: string | null;
  entryTime: Date;
  exitTime: Date | null;
};

const rows = (await db.autoTrade.findMany({
  where: { status: "closed", exitPrice: { not: null } },
  orderBy: { exitTime: "asc" },
  select: {
    symbol: true,
    interval: true,
    side: true,
    entryPrice: true,
    exitPrice: true,
    leverage: true,
    stakePct: true,
    prob: true,
    pnlPct: true,
    exitKind: true,
    entryTime: true,
    exitTime: true,
  },
})) as DbRow[];

const fmt = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
const hold = (m: number | null): string => (m == null ? "—" : m >= 90 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m)}m`);

if (rows.length === 0) {
  console.log("Không có lệnh đóng nào (status=closed, exitPrice ≠ null) trong DB này.");
  process.exit(0);
}

const first = rows[0].exitTime as Date;
const last = rows[rows.length - 1].exitTime as Date;
const storedSum = rows.reduce((a, r) => a + (r.pnlPct ?? 0), 0);

console.log("════════ LỆNH ĐÓNG THEO KHUNG GIỜ — gross từ GIÁ · phí taker 2 bên ════════");
console.log(`DB: ${rows.length} lệnh đóng · ${first?.toISOString().slice(0, 16).replace("T", " ")} → ${last?.toISOString().slice(0, 16).replace("T", " ")} (UTC)`);
console.log("");

const stat = tfTotal(rows);
const per = tfBreakdown(rows);
const W = 10;
const head = ["TF", "n", "WR%", "gross%", "fees%", "net%", "avgNet", "hold", "exits (tp/sl/flip/trail/man)", "flipNet%", "equity%"].map((h, i) => (i === 8 ? h.padEnd(30) : h.padStart(W))).join(" ");
console.log(head);
console.log("-".repeat(head.length));
const line = (s: (typeof per)[number]): string => {
  const ex = s.exits;
  const exStr = `${ex.tp ?? 0}/${ex.sl ?? 0}/${ex.flip ?? 0}/${ex.trail ?? 0}/${ex.manual ?? 0}`;
  return [s.interval, String(s.n), s.winRate.toFixed(1), fmt(s.grossRoe), `-${s.feeRoe.toFixed(2)}`, fmt(s.netRoe), fmt(s.avgNet), hold(s.avgHoldMin), exStr.padEnd(30), fmt(s.flipNet), fmt(s.netEquityPct)]
    .map((c, i) => (i === 8 ? c : c.padStart(W)))
    .join(" ");
};
for (const s of per) console.log(line(s));
console.log("-".repeat(head.length));
console.log(line(stat));
console.log(`
· gross%  = Σ (biến động giá × lev) — tính lại từ entry/exit, đồng nhất mọi phiên bản
· fees%   = Σ 2 × ${FEE_PCT}%/side × lev (taker Binance USDT-M; FEE_PCT runtime như engine)
· net%    = gross − fees (sàn −100/lệnh); WR đếm lệnh net > 0 (SAU phí)
· equity% = Σ net × stakePct — tác động tới chuỗi vốn ảo
· ĐỐI CHIẾU: Σ pnlPct trong DB = ${storedSum.toFixed(2)}% (lệnh trước 0.2.77 lưu GROSS — lệch số này là đúng, không phải bug)
· FUNDING chưa mô hình hoá — ước tính @ 0.01%/8h (baseline Binance):
${per
  .map(
    (s) =>
      `    ${s.interval.padEnd(4)} hold TB ${hold(s.avgHoldMin).padStart(6)} @ ×${s.avgLev} → ~${(
        ((s.avgHoldMin ?? 0) / 60 / 8) *
        0.01 *
        s.avgLev *
        s.n
      ).toFixed(2)}% ROE cộng dồn cả khung`,
  )
  .join("\n")}`);

const cal = calibrationBuckets(rows);
console.log("\n════════ CALIBRATION — prob lúc vào lệnh vs thắng thật (sau phí) ════════");
console.log("(pWin = prob với LONG, 1−prob với SHORT — prob là P(giá lên))");
console.log("");
const cHead = ["pWin bucket", "n", "pred%", "real%", "gap (real−pred)"].map((h, i) => (i === 0 ? h.padEnd(12) : h.padStart(W))).join(" ");
console.log(cHead);
console.log("-".repeat(cHead.length));
for (const b of cal) {
  const label = b.hi > 1 ? `${b.lo.toFixed(2)}+` : `${b.lo.toFixed(2)}-${b.hi.toFixed(2)}`;
  console.log([label.padEnd(12), String(b.n).padStart(W), b.avgPred.toFixed(1).padStart(W), b.winRate.toFixed(1).padStart(W), (b.gap >= 0 ? "+" : "") + b.gap.toFixed(1).padStart(W - 1)].join(" "));
}
console.log(`
· gap < 0 đồng loạt = model over-confident (hoặc leakage / label mismatch —
  kiểm tra walk-forward + Platt calibration §6c). gap ≈ 0 mọi bucket = lành.`);

console.log("\n════════ COPY-PASTE (gửi audit) ════════");
console.log(`closed=${stat.n} wr=${stat.winRate.toFixed(1)}% gross=${fmt(stat.grossRoe)}% fees=-${stat.feeRoe.toFixed(2)}% net=${fmt(stat.netRoe)}% equity=${fmt(stat.netEquityPct)}%`);
for (const s of per) {
  console.log(`${s.interval}: n=${s.n} wr=${s.winRate.toFixed(1)}% gross=${fmt(s.grossRoe)}% fee=-${s.feeRoe.toFixed(2)}% net=${fmt(s.netRoe)}% avg=${fmt(s.avgNet)} flip=${fmt(s.flipNet)}`);
}

await db.$disconnect();
process.exit(0);
