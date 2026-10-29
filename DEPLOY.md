# Hướng dẫn Deploy — Elliott Paper Trading

App là **Next.js 16 (standalone) + Prisma/SQLite (file)** — chạy tốt trên bất kỳ host Node.js/Bun nào có filesystem ghi được. Tài liệu này liệt kê các cách deploy đã được thiết lập trong repo.

## 1. Build pipeline (đã fix lỗi CI)

`bun run build` thực hiện đủ 4 bước — **không được bỏ bước nào**:

```
prisma generate          # tạo .prisma/client — BẮT BUỘC trên máy CI mới
  → next build           # output: standalone
  → cp static + public   # gom đủ tài nguyên cho standalone
  → node scripts/obfuscate.mjs   # mã hóa 80 file JS, xóa sourcemap
```

Ngoài ra `postinstall: prisma generate` đảm bảo client được tạo ngay sau `bun install` — đây chính là lỗi `Cannot find module '.prisma/client/default'` trước đây khi deploy.

## 2. Z.ai / platform deploy từ GitHub (khuyến nghị — đã hoạt động)

Không cần cấu hình gì thêm:

- **Build command:** `bun run build`
- **Start command:** `bun run start` (hoặc `NODE_ENV=production bun .next/standalone/server.js`)
- **Env bắt buộc:** `DATABASE_URL="file:/app/db/custom.db"` (hoặc đường dẫn bất kỳ trên disk bền vững)
- **Env tùy chọn:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (có thể nhập token ngay trong app → panel Auto → nút Token)
- **Dữ liệu:** thư mục `db/` chứa SQLite + cấu hình Telegram — cần mount/persistent disk nếu platform rebuild thường xuyên

## 3. Docker (chạy độc lập bất kỳ đâu)

```bash
docker build -t elliott .
docker run -d --name elliott -p 3000:3000 \
  -v elliott-db:/app/db \
  -e DATABASE_URL="file:/app/db/custom.db" \
  elliott
# → http://localhost:3000
```

Image cuối chỉ chứa **bundle đã obfuscate** — không có source, không sourcemap, không build tooling. Lần chạy đầu cần tạo schema trong volume:

```bash
docker exec elliott bunx prisma db push --accept-data-loss   # 1 lần sau khi mount volume mới
```

(Prisma client đọc `DATABASE_URL` lúc runtime; lệnh trên tạo các bảng trong file SQLite mới.)

## 4. Node hosts khác (Railway / Render / Fly.io / VPS)

- **Build:** `bun install && bun run build` (postinstall tự generate prisma)
- **Start:** `bun run start`
- **Env:** `DATABASE_URL` trỏ vào persistent disk; Railway/Render có sẵn variable + volume
- **Port:** standalone server đọc `PORT`/`HOSTNAME` — đặt theo platform
- **VPS thuần:** dùng Dockerfile ở trên, hoặc `bun run build && bun run start` với systemd + `WorkingDirectory=/srv/elliott`

## 5. Cloudflare — giới hạn thực tế (đọc trước khi thử)

⚠️ **Cloudflare Workers/Pages (edge) KHÔNG chạy được app này ở dạng hiện tại**, vì 3 ràng buộc cứng:

1. **Không có filesystem ghi** — SQLite file (`db/custom.db`) và `db/telegram.json` không ghi được trên workerd
2. **Prisma engine là binary Node** — cần driver adapter (`@prisma/adapter-d1`) thay vì engine
3. API routes dùng `fs` đồng bộ (telegram store) — không tồn tại ở edge

Để chạy thật trên Cloudflare cần migrate lớn: **SQLite → D1** (Cloudflare SQL database), `telegram.json → KV/D1`, chạy qua **@opennextjs/cloudflare**. Đây là thay đổi kiến trúc đáng kể — yêu cầu nếu muốn tôi triển khai.

**Lựa chọn thực dụng:** host app ở đâu đó có Node (mục 2–4) và đặt Cloudflare **proxy/CDN + SSL** phía trước (DNS proxied) — vẫn được tốc độ toàn cầu của Cloudflare mà không phải sửa code.

## 6. Bảo vệ source code (đã bật)

- **Obfuscate lúc build:** `scripts/obfuscate.mjs` mã hóa toàn bộ JS của server bundle (hex identifiers + string array), xóa toàn bộ sourcemap — artifact production không đọc được như source
- **Repo:** cân nhắc chuyển **Private** trong GitHub Settings (lưu ý: kiểm tra platform deploy vẫn truy cập được repo sau khi chuyển)
- **LICENSE:** proprietary — mọi sao chép/sửa/phân phối không được phép
- Git đã loại `.env`, `db/`, token Telegram khỏi repo (`.gitignore`)
