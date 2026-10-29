# Hướng dẫn Deploy — Elliott Paper Trading

App là **Next.js 16 (standalone) + Prisma/SQLite (file)** — chạy tốt trên bất kỳ host Node.js/Bun nào có filesystem ghi được. Tài liệu này liệt kê các cách deploy đã được thiết lập trong repo.

## 1. Kiến trúc khuyến nghị: backend + frontend trên VPS Ubuntu, domain qua cloudflared ✅

> **Trả lời câu hỏi "frontend lên Cloudflare Pages được không?"** — KHÔNG nên và không cần:
> app này không tách được frontend/backend theo kiểu tĩnh vì UI và API là **cùng một server Next.js** (các trang gọi `/api/*` tương đối). Cloudflare Pages chỉ host được static — mà phần động (11 route API, SQLite, Telegram, JSON state) bắt buộc cần Node + filesystem. **Mọi domain trỏ qua tunnel cloudflared về VPS là được frontend + backend "2 trong 1"**, và vẫn được toàn bộ lợi ích Cloudflare (SSL, CDN, DDoS protection, ẩn IP VPS).

Sơ đồ:

```
Browser → elliott.huyenbao.com (Cloudflare CDN/SSL)
              │ tunnel cloudflared (chạy sẵn trên VPS cho huyenbao.com)
              ▼
        http://localhost:3000  ← systemd "elliott" (Next.js standalone)
              ├── /api/*          (backend: klines, autotrade, telegram, …)
              ├── SQLite          /opt/elliott/data/custom.db
              └── JSON state      /opt/elliott/data/telegram.json, autostat.json
```

### Cài đặt 1 lệnh trên VPS (Ubuntu 22.04/24.04)

```bash
git clone https://github.com/DuoLE3383/Elliot /tmp/elliott-src
sudo bash /tmp/elliott-src/deploy/install-ubuntu.sh
```

Script tự làm hết: Node 22 + Bun → clone vào `/opt/elliott` → `.env` (`DATABASE_URL` **tuyệt đối** trỏ `/opt/elliott/data/custom.db` + `DATA_DIR`) → `bun install` → `bun run build` → `prisma db push` → systemd (`elliott.service`, bind `127.0.0.1:3000`, restart luôn khi crash) → health check.

### Map elliott.huyenbao.com vào tunnel CÓ SẴN (đừng tạo tunnel mới)

```bash
# 1. Tìm tunnel UUID hiện có
sudo cloudflared tunnel list

# 2. Sửa config của tunnel đó (/etc/cloudflared/config.yml hoặc ~/.cloudflared/config.yml)
#    — thêm ingress rule ĐẦU TIÊN (mẫu đầy đủ: deploy/cloudflared-elliott.yml):
ingress:
  - hostname: elliott.huyenbao.com
    service: http://localhost:3000
  # …giữ nguyên các rule hiện có (huyenbao.com…)…
  - service: http_status:404

# 3. Tạo DNS record (CNAME elliott → <TUNNEL-UUID>.cfargotunnel.com, proxied)
sudo cloudflared tunnel route dns <TUNNEL-UUID> elliott.huyenbao.com

# 4. Restart
sudo systemctl restart cloudflared
```

→ **https://elliott.huyenbao.com** chạy app hoàn chỉnh. Update sau này: `sudo bash /opt/elliott/deploy/update.sh` (pull → build → restart, **không bao giờ mất data** vì SQLite + JSON nằm ngoài thư mục code). Xem log: `journalctl -u elliott -f`.

### ⚠️ Lưu ý vận hành quan trọng

- **Auto-trade (dry-run) chạy trong tab trình duyệt**, không phải trên server: engine quét + train XGB chạy client-side, server chỉ lưu trades + gửi Telegram. Muốn auto chạy 24/7 phải **giữ mở 1 tab** (desktop/điện thoại bất kỳ). Đây là design hiện tại — nếu muốn engine chạy server-side (không cần mở tab) là một tính năng mới cần triển khai thêm.
- Chỉ nhập Telegram token trong **panel Auto → Token bot Telegram** (lưu runtime, không cần sửa .env).
- VPS cấu hình tối thiểu thoải mái: 1 vCPU / 1 GB RAM (build tốn ~500 MB, có thể build trên máy khác rồi rsync `.next/standalone`).

## 2. Build pipeline (đã fix lỗi CI)

`bun run build` = 3 bước, **không thể fail vì môi trường CI**:

```
prisma generate            # tạo .prisma/client — BẮT BUỘC trên máy CI mới
  → next build             # output: standalone
  → node scripts/postbuild.mjs   # copy static + public, XÓA sourcemap,
                                 # obfuscate CHỈ khi OBFUSCATE=1 (thiếu package → skip, không fail)
```

- `postinstall: prisma generate` chạy ngay sau install — fix hẳn lỗi `Cannot find module '.prisma/client/default'`.
- **Obfuscation giờ là opt-in**: `bun run build:secure` (≈ obfuscate toàn bộ server bundle). Build mặc định vẫn luôn xóa sourcemap nên source không lộ qua `.map`.
- `npm install && npm run build` trên máy không có Bun vẫn chạy bình thường.

## 3. Deploy lên platform (Rollout/CI từ GitHub)

- **Build command:** `bun run build`
- **Start command:** `bun run start` (hoặc `NODE_ENV=production bun .next/standalone/server.js`)
- **Env bắt buộc:** `DATABASE_URL="file:/app/data/custom.db"` (đường dẫn tuyệt đối trên disk bền vững; kèm `DATA_DIR=/app/data` để telegram.json/autostat.json cùng chỗ)
- **Env tùy chọn:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (hoặc nhập trong app → panel Auto → Token)
- **Dữ liệu:** mount persistent volume cho thư mục data; platform rebuild không mất lịch sử trades

## 4. Docker (chạy độc lập bất kỳ đâu)

```bash
docker build -t elliott .
docker run -d --name elliott -p 3000:3000 \
  -v elliott-data:/app/data \
  -e DATABASE_URL="file:/app/data/custom.db" \
  -e DATA_DIR="/app/data" \
  elliott
# → http://localhost:3000
```

Lần chạy đầu (volume mới) cần tạo bảng:

```bash
docker exec elliott bunx prisma db push   # chỉ tạo bảng, không phá data có sẵn
```

(Prisma client đọc `DATABASE_URL` lúc runtime; bundle đã xóa sourcemap — build kèm `--build-arg OBFUSCATE=1` nếu muốn obfuscate trong image.)

## 5. Node hosts khác (Railway / Render / Fly.io)

- **Build:** `bun install && bun run build` (postinstall tự generate prisma)
- **Start:** `bun run start`
- **Env:** `DATABASE_URL` + `DATA_DIR` trỏ vào persistent volume
- **Port:** standalone server đọc `PORT`/`HOSTNAME` — đặt theo platform

## 6. Cloudflare — giới hạn thực tế (đọc trước khi thử)

⚠️ **Cloudflare Workers/Pages (edge) KHÔNG chạy được app này ở dạng hiện tại**, vì 3 ràng buộc cứng:

1. **Không có filesystem ghi** — SQLite file và `telegram.json` không ghi được trên workerd
2. **Prisma engine là binary Node** — cần driver adapter (`@prisma/adapter-d1`) thay vì engine
3. API routes dùng `fs` đồng bộ (telegram store, autostat) — không tồn tại ở edge

Để chạy thật trên Workers cần migrate lớn: **SQLite → D1**, JSON state → KV/D1, chạy qua **@opennextjs/cloudflare**. Đây là thay đổi kiến trúc đáng kể — yêu cầu nếu muốn triển khai.

**Lựa chọn thực dụng đã dùng ở mục 1:** host app trên VPS và trỏ domain qua **cloudflared tunnel** — vẫn được SSL + CDN + DDoS protection + ẩn IP của Cloudflare mà không phải sửa một dòng code nào.

## 7. Bảo vệ source code (đã bật)

- **Sourcemap luôn bị xóa** trong mọi bản build production (`scripts/postbuild.mjs`)
- **Obfuscate:** `bun run build:secure` — hex identifiers + string array trên toàn bộ server bundle; artifact production không đọc được như source
- **VPS/tunnel:** code không bao giờ rời server — browser chỉ nhận HTML/CSS/JS đã compile
- **Repo:** cân nhắc chuyển **Private** trong GitHub Settings (lưu ý: platform deploy phải vẫn truy cập được repo sau khi chuyển)
- **LICENSE:** proprietary — mọi sao chép/sửa/phân phối không được phép
- Git đã loại `.env`, `db/`, `data/`, token Telegram khỏi repo (`.gitignore`)
