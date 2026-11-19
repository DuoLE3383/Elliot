# Deploy Guide — Elliott Paper Trading

The app is **Next.js 16 (standalone) + Prisma / SQLite (file)**. It runs on any Node.js / Bun host that has a writable filesystem. This document covers the deployment paths already prepared in the repository.

## 1. Recommended architecture: VPS Ubuntu + Cloudflare Tunnel

> **Can the frontend be hosted on Cloudflare Pages?** — No.  
> The UI and API live in the **same Next.js server** (pages call relative `/api/*` routes). Cloudflare Pages only serves static assets. Dynamic parts (API routes, SQLite, Telegram, JSON state) require Node + a writable filesystem. Pointing a domain through a **cloudflared tunnel** to the VPS gives you frontend + backend together, plus Cloudflare SSL, CDN and DDoS protection while hiding the VPS IP.

```
Browser → elliott.example.com (Cloudflare CDN / SSL)
              │ cloudflared tunnel
              ▼
        http://127.0.0.1:3000  ← systemd service "elliott" (Next.js standalone)
              ├── /api/*          (klines, autotrade, telegram, journal…)
              ├── SQLite          /opt/elliott/data/custom.db
              └── JSON state      /opt/elliott/data/*.json
```

### One-command install on Ubuntu 22.04 / 24.04

```bash
git clone https://github.com/DuoLE3383/Elliot /tmp/elliott-src
sudo bash /tmp/elliott-src/deploy/install-ubuntu.sh
```

The script installs Node 22 + Bun, clones into `/opt/elliott`, writes `.env` (DATABASE_URL pointing at `/opt/elliott/data/custom.db`), runs `bun install` + `bun run build` + `prisma db push`, creates a systemd unit `elliott.service` (bind `127.0.0.1:3000`, auto-restart), and performs a health check.

### Attach the domain to an existing cloudflared tunnel

```bash
# 1. List tunnels
sudo cloudflared tunnel list

# 2. Edit the tunnel config (usually /etc/cloudflared/config.yml)
#    Put the new rule FIRST (full example: deploy/cloudflared-elliott.yml):
ingress:
  - hostname: elliott.example.com
    service: http://localhost:3000
  # … keep existing rules …
  - service: http_status:404

# 3. Create the DNS CNAME (proxied)
sudo cloudflared tunnel route dns <TUNNEL-UUID> elliott.example.com

# 4. Restart
sudo systemctl restart cloudflared
```

## 2. Environment variables

Copy `.env.example` → `.env` (or let the install script create it).

| Variable              | Required | Description |
|-----------------------|----------|-------------|
| `DATABASE_URL`        | yes      | SQLite path, e.g. `file:/opt/elliott/data/custom.db` |
| `DATA_DIR`            | recommended | Directory for JSON state files |
| `TELEGRAM_BOT_TOKEN`  | optional | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID`    | optional | Channel id (`-100…`) or public `@name` / `t.me` link |
| `TELEGRAM_API_BASE`   | rarely   | Only if you run a Bot API proxy (see §6) |

Never commit `.env`. The install script and `.gitignore` already protect it.

## 3. systemd service

After install the unit lives at `/etc/systemd/system/elliott.service`.

Useful commands:

```bash
sudo systemctl status elliott
sudo systemctl restart elliott
sudo journalctl -u elliott -f
```

The service runs the standalone server produced by `next build` (`node .next/standalone/server.js`).

## 4. Updating the app
### ⚠️ Lưu ý vận hành quan trọng

- **Auto-trade (dry-run) chạy trong tab trình duyệt**, không phải trên server: engine quét + train XGB chạy client-side, server chỉ lưu trades + gửi Telegram. Muốn auto chạy 24/7 phải **giữ mở 1 tab** (desktop/điện thoại bất kỳ). Đây là design hiện tại — nếu muốn engine chạy server-side (không cần mở tab) là một tính năng mới cần triển khai thêm.
- **TP/SL theo ATR (mặc định)**: nguồn TP/SL "**ATR lúc entry**" đo biến động thật của coin ngay trước khi vào lệnh — SL% = ATR(14)% × hệ số (UI mặc định 1.5), TP% = SL × 1.4, kẹp biên an toàn 0.3–20% / 0.4–28%. Coin lặng → SL hẹp, coin nóng → SL rộng; hết kiểu số cố định "cào bằng". Hệ số còn được **retrain riêng cho từng coin** lúc quét (suggestion quét hệ số 1.0/1.5/2.0/2.5/3.0 theo kỳ vọng thật của lịch sử coin và chọn hệ số kiếm nhiều nhất) — lệnh sẽ dùng hệ số retrained của coin đó thay cho hệ số UI. Hai chế độ còn lại: "**Mức lúc quét**" (SL/TP đóng băng lúc quét — cũ) và "**Thủ công**" (số % cố định do bạn nhập). Tin Telegram mở lệnh ghi rõ `📏 SL/TP = ATR x.xx% × hệ số — đo lúc vào lệnh`.
- **Chống trùng lặp khi mở nhiều tab / nhiều máy (anti-spam 2 lớp)**: engine auto chạy client-side nên 10 tab từng nghĩa là 10 lần train + 10 vòng quét + 10 luồng thông báo. Bản mới: **(1) Bầu trưởng giữa các tab** — qua BroadcastChannel, chỉ tab "trưởng" chạy chu kỳ/quét/train/gửi tin, tab còn lại chỉ hiển thị (badge vàng "Bot đang chạy ở tab khác"); tab trưởng đóng là tab chờ tự lên thay trong vài giây. **(2) Dedupe Telegram phía server** — mọi tin đi qua `tgSendMessage` với **khoá ngữ nghĩa** (`open:<id>`, `close:<id>`, `near:<id>:tp|sl`, `top:<bucket-5-phút>`, `veto:<pair>:<tf>:<side>:<bucket>`): N tab/máy báo cùng 1 sự kiện → đúng 1 tin ra kênh; trạng thái lưu `DATA_DIR/tg-dedupe.json`, sống sót qua restart, tự rollback khi gửi lỗi (tab khác gửi lại được). Cửa sổ mặc định 90s, đổi bằng env `TG_DEDUPE_MS` (0 = tắt — không khuyến khích). Nút "Kiểm tra Telegram" chủ động bỏ qua dedupe (bấm là gửi thật).
- **Feature chu kỳ lịch + chế độ biến động (model học thay vì đếm tay)**: vector feature của XGBoost bổ sung 8 đầu vào mới (30 tổng): `dowSin/dowCos` (chu kỳ thứ trong tuần), `domStart/domEnd/qEnd` (đầu tháng 1–3 / 3 ngày cuối tháng / kết quý), `atrRank` + `bbwRank` (ATR% và độ rộng Bollinger nằm percentile nào trong 100 nến trước — thấp = nén biến động), `donchian` (đóng cửa ở đâu trong range 20 nến trước, 0=đáy 1=đỉnh). Toàn bộ chỉ dùng dữ liệu quá khứ (không lookahead) → model **tự học** chu kỳ thứ/cuối tháng/kết quý và tiền đề bùng nổ riêng cho từng coin — phiên bản "train được" của block 📅 tần suất.
- **Khử nhiễu XGBoost (nhấn mạnh Wyckoff + phiên)**: vector feature 30 → **38** — thêm 6 encoding **Wyckoff Schematic** (pure, no-lookahead, `wyck-features.ts`): `wyRangePos/wyRangeW` (vị trí giá trong range 60 nến + độ rộng range — vùng PS/SC/AR/ST), `wyClimax` (Selling/Buying Climax — nến ≥1.5σ volume + ≥1.2×ATR, ký hiệu theo nơi đóng, decay 8 nến), `wySpring` (**Phase C** — Spring thủng đáy rồi đóng lại / Upthrust poking đỉnh rồi rơi vào), `wyEffort` (effort ≠ result — volume lớn mà giá đi không xa = absorption), `wyTrend` (markup/markdown: EMA50 dốc + giá đối chiếu SMA100); và 2 feature **phiên** mới: `sessOverlap` (London ∩ New York — 12:00–16:00 UTC sổ sâu nhất) + `sessAge` (số phút từ đầu phiên gần nhất /480). Kèm **cổng khử nhiễu**: `NOISE_BAND = 0.06` — model P nằm trong 0.44–0.56 (chưa quyết đoán) bị coi là nhiễu, auto engine **từ chối vào lệnh** (xem dòng giải thích trong card "Quét 8h"; đặt 0 để tắt).
- **Quét 8h — bộ cặp CỨNG trong source** (`src/lib/universe.ts`, 48 cặp majors + high-ATR alts, từng pair đã verify trên board USDT-M — TONUSDT delisted đã loại): 11 pair "staples" (BTC ETH BNB XRP SOL TRX ZEC DOGE XMR ADA BCH) luôn đứng đầu danh sách, tab trưởng quét nến 1h toàn bộ  **mỗi 8 giờ** (độc lập localStorage — không phụ thuộc watchlist từng trình duyệt), chấm điểm `60% trend (EMA20/50 spread + Donchian) + 40% ATR%`, hiển thị **top 30** trong card "🔄 Quét 8h" của panel Auto (bấm để mở pair đó trên đồ thị) và **tự đưa cả top-30 vào watchlist** của user (gộp, không trùng, không đè pair người dùng) kèm gửi Telegram mỗi bucket 8h (dedupe key `universe:<bucket>`). Chu kỳ "Quét tất cả" rơi vào bộ cặp cứng này khi watchlist đang rỗng. Symbol spot cũ trong localStorage tự migrate sang tên futures (PEPEUSDT→1000PEPEUSDT, SHIBUSDT→1000SHIBUSDT) và pair không có perp (DAIUSDT, TONUSDT) tự bị loại — hết 400 "invalid symbol". Test: `bun run scripts/test-wyck-universe.ts` (38 checks — gồm kiểm chứng NO-LOOKAHEAD bằng cách đục tương lai).
- **Scanner bùng nổ** (script, chạy lúc cần): `bun run scripts/explosion-scan.ts BTCUSDT 4 4` — tải 4+ năm nến 1d từ Binance, liệt kê mọi ngày |return| ≥ 4% (gộp cụm ≤2 ngày), thống kê tiền đề (BBW/ATR percentile trước bùng nổ, xác suất có điều kiện so với nền), phân bố theo thứ/cửa sổ lịch, khoảng cách giữa 2 lần, burst 1h gần nhất và **điểm tiền đề bùng nổ hiện tại 0–100**. Xuất `download/explosion-report.json` + biểu đồ `scripts/chart-explosion.py`.
- **Telegram — 1 cách duy nhất (cố định trong .env)**: `sudo bash deploy/set-telegram-env.sh "<BOT_TOKEN>" "<CHAT_ID>"` — ghi `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` vào `.env` của repo, tự restart nếu có systemd, tự verify. Xem cấu hình hiện tại: `sudo bash deploy/set-telegram-env.sh` (không đối số). CHAT_ID chấp nhận id số (-100…), @username hoặc link https://t.me/… — app tự chuẩn hoá. Lấy id kênh private: thêm bot làm admin kênh rồi đọc id trong log/Telegram Bot API. Đổi token/kênh = chạy lại lệnh đó. Panel Auto chỉ còn nút **Kiểm tra Telegram** (gửi tin test vào kênh) — mọi cấu hình khác nằm hết trong .env.
- VPS cấu hình tối thiểu thoải mái: 1 vCPU / 1 GB RAM (build tốn ~500 MB, có thể build trên máy khác rồi rsync `.next/standalone`).

## 1b. Local ≠ Website là ĐÚNG — mỗi máy một DB riêng (git không đồng bộ data)

`git pull` / `update.sh` chỉ đồng bộ **CODE**. Dữ liệu nằm ở **3 chỗ độc lập trên từng máy**:

| Kho | VPS (elliott.huyenbao.com) | Máy local | Đồng bộ bằng git? |
| --- | --- | --- | --- |
| SQLite (lệnh, journal, win-rate, vốn, suggestions, finetune) | `/opt/elliott/data/custom.db` (`.env` ghi đường dẫn tuyệt đối) | `<repo>/db/custom.db` (mặc định) | ❌ KHÔNG |
| JSON state (`DATA_DIR`: telegram.json, session-bcast.json, tg-dedupe.json…) | `/opt/elliott/data/` | `<repo>/db/` | ❌ KHÔNG |
| localStorage trình duyệt (watchlist, symbol/interval, settings, cấu hình Auto) | theo từng trình duyệt | theo từng trình duyệt | ❌ KHÔNG |

→ Muốn local "giống" website thì phải **chép data** (git không làm hộ):

1. **Soi từng máy** — chạy ở cả 2 nơi rồi đặt output cạnh nhau:
   ```bash
   bun run scripts/db-doctor.ts        # in: git HEAD, đường dẫn DB thật, số lệnh mở/đóng, win-rate, vốn, lệnh cuối
   ```
   Doctor luôn lấy giá trị trong **file .env** làm chuẩn (nguồn dev server & systemd `EnvironmentFile` đều đọc lúc boot) — bỏ qua env cũ còn sót trong shell.
2. **Kéo DB VPS về local (một chiều)** — dừng dev server local trước:
   ```bash
   bash scripts/sync-db-from-vps.sh user@ip-vps [/opt/elliott]
   # tự backup db/custom.db.bak.<thời-gian> → tạo snapshot an toàn trên VPS → kéo về → tự chạy db-doctor kiểm chứng
   ```
3. **Không bật Auto đồng thời ở cả 2 máy**: engine auto chạy client-side theo **origin** (BroadcastChannel chỉ gói các tab cùng origin — `localhost:3000` và `elliott.huyenbao.com` là 2 origin riêng) → local + web cùng bật = **2 engine độc lập**, mỗi bên tự train/tự quét/tự mở lệnh/tự gửi Telegram riêng. Dedupe Telegram là **per-server** (khoá nằm trong `DATA_DIR` của từng server) nên không chặn được chéo máy. Muốn local chỉ xem: **tắt Auto ở tab local** (badge vàng "tab chờ" chỉ hoạt động giữa các tab cùng origin). *Lưu ý: khi 2 instance CÙNG máy đã dùng chung DB, 2 engine tranh 1 slot vị thế (server chặn 409) nhưng vẫn 2 vòng train/quét riêng — tắt Auto 1 phía vẫn là gọn nhất.*
4. Muốn sync ngược (local → VPS) hoặc sync tự động: tự chịu rủi ro — SQLite chéo máy chỉ an toàn khi app bên nhận ĐANG DỪNG; khuyến nghị giữ VPS là nguồn duy nhất (single source of truth).

### Dùng chung 1 DB cho TẤT CẢ (khi các instance cùng 1 máy)

Vì sao website "dùng DB lạ"? Production đọc env từ `/opt/elliott/.env` (systemd `EnvironmentFile`), update.sh ghi sẵn cho nó DB riêng `/opt/elliott/data/custom.db`; bản dev dùng mặc định `<repo>/db/custom.db` — **2 instance = 2 .env = 2 DB**. Muốn chung thì trỏ CẢ HAI `.env` vào CÙNG một thư mục:

```bash
cd /opt/elliott
git pull
bun install          # or npm install
bun run build        # or npm run build
sudo systemctl restart elliott
```

If you use pm2 instead of systemd:

```bash
git pull && npm install && npx prisma db push && npm run build && pm2 restart elliott --update-env && pm2 flush
```

`prisma db push` is required when a release adds tables (0.2.97 added `WyckoffBook` + `LiveBook`) — it creates the missing tables without touching existing data.

## 5. Health checks & common network issues

```bash
# App itself
curl -sf http://127.0.0.1:3000/api/health || echo "down"

# Binance reachability from the VPS
curl -s "https://fapi.binance.com/fapi/v1/ping"
```

If the VPS cannot reach Binance (common with some residential / restricted networks) you will see truncated JSON or connection errors. Mitigations already in the code:

- Retry once on truncated responses
- Optional host override / proxy hints (see source comments in `klines-direct` and Telegram modules)

## 6. Telegram notes

- Session-open broadcasts (Sydney / Tokyo / London / New York) are sent automatically 5 minutes before each global session open. They run server-side from `instrumentation.ts` — no browser needed.
- State is stored under `$DATA_DIR` (or `db/`) so restarts do not duplicate messages.
- To force a test message: set `SESSION_BCAST_FORCE=1` in `.env`, restart, wait ~20 s, then remove the variable.

If the VPS cannot reach `api.telegram.org`, you can point `TELEGRAM_API_BASE` at a Cloudflare Worker proxy (see `deploy/` helpers). Leave it empty unless you really need a proxy.

## 7. Source protection (already enabled)

- Source maps are stripped in every production build (`scripts/postbuild.mjs`).
- Optional obfuscation: `bun run build:secure`.
- The browser only ever receives compiled HTML/CSS/JS.
- Keep the GitHub repository **private**.
- `.env`, `db/`, `data/` and tokens are git-ignored.

## 8. Docker (optional)

A `Dockerfile` is provided for environments that prefer containers. Mount a volume for the SQLite file and set `DATABASE_URL` / `DATA_DIR` accordingly. The recommended production path remains the systemd + cloudflared setup above.

---

For questions or improvements, open an issue or PR in the repository.
