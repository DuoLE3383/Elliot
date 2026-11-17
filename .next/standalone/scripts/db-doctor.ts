// ─── DB doctor — soi kho dữ liệu của MÁY ĐANG CHẠY ───────────────────────────
// Local và website là 2 deployment độc lập: mỗi máy một SQLite + một thư mục
// JSON riêng (git chỉ đồng bộ CODE, không đồng bộ DATA). Chạy script này trên
// CẢ HAI máy rồi đặt 2 output cạnh nhau → thấy ngay máy nào đang cầm DB nào:
//
//     bun run scripts/db-doctor.ts          # local (hoặc VPS, cd vào repo)
//
// In ra: đường dẫn DB thực tế, số lệnh mở/đóng, win-rate, vốn, lệnh cuối,
// số suggestion/finetune, các file JSON state. KHÔNG in token/kênh Telegram.

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// Bun tự load .env — nhưng đề phòng máy chạy bằng node: thử dotenv nhẹ tay.
// Quan trọng: giá trị TRONG FILE .env luôn thắng env kế thừa — vì dev server
// (next dev) và production (systemd EnvironmentFile) đều đọc FILE lúc boot;
// env còn sót trong shell (export DATABASE_URL=... cũ) phải bị bỏ qua, nếu không
// doctor sẽ báo sai chính xác thứ app sắp dùng.
const envFromFile: Record<string, string> = {};
try {
  const envText = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) envFromFile[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* không có .env — dùng env mặc định */ }

const DATA_DIR = envFromFile.DATA_DIR || process.env.DATA_DIR || path.join(process.cwd(), "db");
const dbUrl = envFromFile.DATABASE_URL ?? process.env.DATABASE_URL;
const dbUrlSource = envFromFile.DATABASE_URL ? "file .env" : "env kế thừa";

// Resolve đường dẫn SQLite y hệt Prisma: URL relative được tính từ thư mục
// chứa schema (prisma/) — gặp "file:./db/custom.db" → <repo>/db/custom.db
function resolveSqlite(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/^file:(.*)$/);
  if (!m) return null; // không phải sqlite (postgres/…) — in nguyên URL schema
  const p = m[1];
  if (path.isAbsolute(p)) return p;
  return path.join(process.cwd(), "prisma", p);
}

const line = "─".repeat(64);
console.log(line);
console.log("ELLIOTT DB DOCTOR — kho dữ liệu của máy đang chạy");
console.log(line);

// ── Git HEAD (mức code) ──
try {
  const head = execSync("git rev-parse --short HEAD", { cwd: process.cwd() })
    .toString().trim();
  const subject = execSync("git log -1 --format=%s", { cwd: process.cwd() })
    .toString().trim();
  console.log(`Code (git HEAD) : ${head} — ${subject}`);
} catch {
  console.log("Code (git HEAD) : (không đọc được — không phải repo git?)");
}

// ── Đường dẫn ──
const sqlitePath = resolveSqlite(dbUrl);
console.log(`DATA_DIR        : ${DATA_DIR}${envFromFile.DATA_DIR || process.env.DATA_DIR ? "" : "  (mặc định — .env không đặt DATA_DIR)"}`);
console.log(`DATABASE_URL    : ${dbUrl ? `${sqlitePath ?? dbUrl}  [nguồn: ${dbUrlSource}]` : "(chưa đặt — Prisma sẽ dùng .env/schema.prisma)"}`);
if (sqlitePath) {
  const ok = fs.existsSync(sqlitePath);
  const size = ok ? fs.statSync(sqlitePath).size : 0;
  console.log(`File SQLite     : ${ok ? "CÓ" : "CHƯA TỒN TẠI"}${ok ? ` — ${(size / 1024).toFixed(1)} KB` : ""}`);
}

// ── JSON state trong DATA_DIR ──
try {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) console.log("JSON state      : (không có file nào)");
  for (const f of files) {
    const st = fs.statSync(path.join(DATA_DIR, f));
    console.log(`JSON state      : ${f} — ${(st.size / 1024).toFixed(1)} KB, sửa ${st.mtime.toISOString()}`);
  }
} catch { /* DATA_DIR chưa tồn tại — đã in ở trên */ }

// ── Telegram config: chỉ báo CÓ/KHÔNG, không bao giờ in giá trị ──
const tgTok = envFromFile.TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN;
const tgChat = envFromFile.TELEGRAM_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID;
console.log(`Telegram env    : token=${tgTok ? "có" : "không"} · chat=${tgChat ? "có" : "không"}`);

// ── Nội dung SQLite (nối đúng URL của file .env — không tin env kế thừa) ──
const db = dbUrl
  ? new PrismaClient({ log: [], datasources: { db: { url: dbUrl } } })
  : new PrismaClient({ log: [] });
try {
  const [openN, closedN, sugN, ftN] = await Promise.all([
    db.autoTrade.count({ where: { status: "open" } }),
    db.autoTrade.count({ where: { status: "closed" } }),
    db.suggestion.count(),
    db.finetuneRun.count(),
  ]);
  const closed = await db.autoTrade.findMany({
    where: { status: "closed" },
    select: { pnlPct: true },
  });
  const wins = closed.filter((t) => (t.pnlPct ?? 0) > 0).length;
  const lastRows = await db.autoTrade.findMany({
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  const open = await db.autoTrade.findFirst({ where: { status: "open" } });
  const lastClosed = await db.autoTrade.findFirst({
    where: { status: "closed" },
    orderBy: { createdAt: "desc" },
  });
  const capital = lastClosed?.capitalAfter ?? open?.capitalBefore ?? null;

  console.log(line);
  console.log(`Lệnh ĐANG MỞ    : ${openN}${open ? ` — ${open.symbol} ${open.side} @ ${open.entryPrice} (vào ${open.entryTime.toISOString()})` : ""}`);
  console.log(`Lệnh ĐÃ ĐÓNG    : ${closedN} — thắng ${wins} (win-rate ${closedN ? ((wins / closedN) * 100).toFixed(1) : "0.0"}%)`);
  console.log(`Vốn hiện tại    : ${capital === null ? "?" : capital.toFixed(2)}`);
  console.log(`Suggestion      : ${sugN} dòng`);
  console.log(`FinetuneRun     : ${ftN} dòng`);
  console.log(line);
  console.log("3 lệnh mới nhất (đặt cạnh máy kia để so — khác nhau là ĐÚNG vì 2 DB riêng):");
  for (const t of lastRows) {
    console.log(
      `  ${t.createdAt.toISOString()}  ${t.symbol.padEnd(12)} ${t.side.padEnd(6)} ` +
      `${t.status.padEnd(6)} @${t.entryPrice} pnl=${t.pnlPct ?? "—"}`
    );
  }
  console.log(line);
  console.log("Ghi nhớ: git KHÔNG đồng bộ data. Muốn máy này thấy đúng dữ liệu website:");
  console.log("  bash scripts/sync-db-from-vps.sh user@ip-vps [/opt/elliott]  (dừng dev server trước)");
} catch (e) {
  console.log(`✗ Đọc SQLite lỗi: ${(e as Error).message}`);
  console.log("  → thử: bunx prisma db push --skip-generate  (tạo bảng nếu DB mới tinh)");
} finally {
  await db.$disconnect();
}
