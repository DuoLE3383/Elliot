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

→ **https://elliott.huyenbao.com** chạy app hoàn chỉnh. Update sau này: `cd` vào thư mục repo (bất kể clone ở đâu — `/opt/elliott`, `~/Elliot`, …) rồi `sudo bash deploy/update.sh` (pull → build → **schema sync `prisma db push` vào đúng DB mà `.env` trỏ tới** — hết lỗi `main.Suggestion does not exist` → restart, **không bao giờ mất data** vì SQLite + JSON nằm ngoài thư mục code; script tự suy repo theo vị trí của nó, hoặc ép đường dẫn bằng `sudo APP_DIR=/đường/dẫn bash deploy/update.sh`). Xem log: `journalctl -u elliott -f`.

**Schema tự chữa lành (bản mới)**: app không còn phụ thuộc `db push` chạy đúng chỗ nữa — ngay lần truy vấn DB đầu tiên sau khi boot, nó tự tạo BẤT KỲ bảng nào còn thiếu (`Suggestion`, `FinetuneRun`, `AutoTrade`, …) qua đúng `DATABASE_URL` mà process đang dùng, và nếu gặp P2021 giữa chừng (DB bị thay file, restore, gộp DB…) thì tự dựng lại bảng rồi tự retry lệnh. Nghĩa là kể cả khi `db push` trong update.sh lỡ chạy nhầm DB, app vẫn tự phục hồi và các route `/api/suggestions` + `/api/finetune` + `/api/autotrade` hết 500/503 mà không cần can thiệp tay. Log khi đó in rõ: `[db] schema bootstrap — created missing table(s): …` (hoặc `— ok (all 5 tables present)` khi DB đã đủ).

### Repo PRIVATE — VPS pull cần PAT (cấu hình 1 lần)

Repo đã chuyển **private** để giấu domain/đường dẫn server. Lần pull/clone đầu sau khi chuyển sẽ lỗi auth — cấu hình 1 lần:

```bash
# VPS đang chạy app — cách 1 (khuyến nghị): update.sh tự ghi PAT vào remote URL, nhớ cho các lần sau
sudo GITHUB_TOKEN=<PAT> bash deploy/update.sh

# VPS — cách 2 (tay): cd vào repo rồi
git remote set-url origin https://<PAT>@github.com/DuoLE3383/Elliot.git

# Cài mới trên VPS:
git clone https://<PAT>@github.com/DuoLE3383/Elliot /tmp/elliott-installer
sudo GITHUB_TOKEN=<PAT> bash /tmp/elliott-installer/deploy/install-ubuntu.sh
```

Lưu ý: PAT không nằm trong code — chỉ nằm trong `.git/config` của chính máy bạn (update.sh tự `chmod 600`). Muốn xoá: `git remote set-url origin https://github.com/DuoLE3383/Elliot.git`.

### ⚠️ Lưu ý vận hành quan trọng

- **Auto-trade (dry-run) chạy trong tab trình duyệt**, không phải trên server: engine quét + train XGB chạy client-side, server chỉ lưu trades + gửi Telegram. Muốn auto chạy 24/7 phải **giữ mở 1 tab** (desktop/điện thoại bất kỳ). Đây là design hiện tại — nếu muốn engine chạy server-side (không cần mở tab) là một tính năng mới cần triển khai thêm.
- **TP/SL theo ATR (mặc định)**: nguồn TP/SL "**ATR lúc entry**" đo biến động thật của coin ngay trước khi vào lệnh — SL% = ATR(14)% × hệ số (UI mặc định 1.5), TP% = SL × 1.4, kẹp biên an toàn 0.3–20% / 0.4–28%. Coin lặng → SL hẹp, coin nóng → SL rộng; hết kiểu số cố định "cào bằng". Hệ số còn được **retrain riêng cho từng coin** lúc quét (suggestion quét hệ số 1.0/1.5/2.0/2.5/3.0 theo kỳ vọng thật của lịch sử coin và chọn hệ số kiếm nhiều nhất) — lệnh sẽ dùng hệ số retrained của coin đó thay cho hệ số UI. Hai chế độ còn lại: "**Mức lúc quét**" (SL/TP đóng băng lúc quét — cũ) và "**Thủ công**" (số % cố định do bạn nhập). Tin Telegram mở lệnh ghi rõ `📏 SL/TP = ATR x.xx% × hệ số — đo lúc vào lệnh`.
- **Chống trùng lặp khi mở nhiều tab / nhiều máy (anti-spam 2 lớp)**: engine auto chạy client-side nên 10 tab từng nghĩa là 10 lần train + 10 vòng quét + 10 luồng thông báo. Bản mới: **(1) Bầu trưởng giữa các tab** — qua BroadcastChannel, chỉ tab "trưởng" chạy chu kỳ/quét/train/gửi tin, tab còn lại chỉ hiển thị (badge vàng "Bot đang chạy ở tab khác"); tab trưởng đóng là tab chờ tự lên thay trong vài giây. **(2) Dedupe Telegram phía server** — mọi tin đi qua `tgSendMessage` với **khoá ngữ nghĩa** (`open:<id>`, `close:<id>`, `near:<id>:tp|sl`, `top:<bucket-5-phút>`, `veto:<pair>:<tf>:<side>:<bucket>`): N tab/máy báo cùng 1 sự kiện → đúng 1 tin ra kênh; trạng thái lưu `DATA_DIR/tg-dedupe.json`, sống sót qua restart, tự rollback khi gửi lỗi (tab khác gửi lại được). Cửa sổ mặc định 90s, đổi bằng env `TG_DEDUPE_MS` (0 = tắt — không khuyến khích). Nút "Kiểm tra Telegram" chủ động bỏ qua dedupe (bấm là gửi thật).
- **Feature chu kỳ lịch + chế độ biến động (model học thay vì đếm tay)**: vector feature của XGBoost bổ sung 8 đầu vào mới (30 tổng): `dowSin/dowCos` (chu kỳ thứ trong tuần), `domStart/domEnd/qEnd` (đầu tháng 1–3 / 3 ngày cuối tháng / kết quý), `atrRank` + `bbwRank` (ATR% và độ rộng Bollinger nằm percentile nào trong 100 nến trước — thấp = nén biến động), `donchian` (đóng cửa ở đâu trong range 20 nến trước, 0=đáy 1=đỉnh). Toàn bộ chỉ dùng dữ liệu quá khứ (không lookahead) → model **tự học** chu kỳ thứ/cuối tháng/kết quý và tiền đề bùng nổ riêng cho từng coin — phiên bản "train được" của block 📅 tần suất.
- **Khử nhiễu XGBoost (nhấn mạnh Wyckoff + phiên)**: vector feature 30 → **38** — thêm 6 encoding **Wyckoff Schematic** (pure, no-lookahead, `wyck-features.ts`): `wyRangePos/wyRangeW` (vị trí giá trong range 60 nến + độ rộng range — vùng PS/SC/AR/ST), `wyClimax` (Selling/Buying Climax — nến ≥1.5σ volume + ≥1.2×ATR, ký hiệu theo nơi đóng, decay 8 nến), `wySpring` (**Phase C** — Spring thủng đáy rồi đóng lại / Upthrust poking đỉnh rồi rơi vào), `wyEffort` (effort ≠ result — volume lớn mà giá đi không xa = absorption), `wyTrend` (markup/markdown: EMA50 dốc + giá đối chiếu SMA100); và 2 feature **phiên** mới: `sessOverlap` (London ∩ New York — 12:00–16:00 UTC sổ sâu nhất) + `sessAge` (số phút từ đầu phiên gần nhất /480). Kèm **cổng khử nhiễu**: `NOISE_BAND = 0.06` — model P nằm trong 0.44–0.56 (chưa quyết đoán) bị coi là nhiễu, auto engine **từ chối vào lệnh** (xem dòng giải thích trong card "Vũ trụ quét 8h"; đặt 0 để tắt).
- **Vũ trụ quét 8h — bộ cặp CỨNG trong source** (`src/lib/universe.ts`, 48 cặp majors + high-ATR alts, từng pair đã verify trên board USDT-M — TONUSDT delisted đã loại): 11 pair "staples" (BTC ETH BNB XRP SOL TRX ZEC DOGE XMR ADA BCH) luôn đứng đầu danh sách, tab trưởng quét nến 1h toàn bộ vũ trụ **mỗi 8 giờ** (độc lập localStorage — không phụ thuộc watchlist từng trình duyệt), chấm điểm `60% trend (EMA20/50 spread + Donchian) + 40% ATR%`, hiển thị **top 30** trong card "🔄 Vũ trụ quét 8h" của panel Auto (bấm để mở pair đó trên đồ thị) và **tự đưa cả top-30 vào watchlist** của user (gộp, không trùng, không đè pair người dùng) kèm gửi Telegram mỗi bucket 8h (dedupe key `universe:<bucket>`). Chu kỳ "Quét tất cả" rơi vào bộ cặp cứng này khi watchlist đang rỗng. Symbol spot cũ trong localStorage tự migrate sang tên futures (PEPEUSDT→1000PEPEUSDT, SHIBUSDT→1000SHIBUSDT) và pair không có perp (DAIUSDT, TONUSDT) tự bị loại — hết 400 "invalid symbol". Test: `bun run scripts/test-wyck-universe.ts` (38 checks — gồm kiểm chứng NO-LOOKAHEAD bằng cách đục tương lai).
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
sudo bash scripts/share-db.sh /opt/elliott/data              # dev (repo này) ghé vào sổ của website
sudo bash scripts/share-db.sh /opt/elliott/data /opt/elliott/.env   # …và bảo đảm web cũng trỏ đúng đó
# xong: restart cả hai — dev: bunx next dev -p 3100 (né cổng 3000 của prod) · prod: sudo systemctl restart elliott
```

Script tự: mkdir thư mục chung → kiểm quyền ghi → sửa `DATABASE_URL` + `DATA_DIR` (giữ nguyên `TELEGRAM_*`) → bật WAL nếu có sqlite3 → chạy db-doctor kiểm chứng. Khi dùng chung (cùng máy):

- ✓ localhost và website xem **cùng sổ lệnh** / journal / win-rate / vốn
- ✓ 2 engine (tab local + tab web) tranh **1 slot vị thế duy nhất** — server chặn `409 position_open`, không bao giờ mở song song
- ✓ `autostat.json` (marker báo cáo giờ/ngày) dùng chung → hết 2 báo cáo trùng; `tg-dedupe.json` dùng chung → anti-spam chéo cả 2 instance
- ⚠ localStorage (watchlist, symbol, cấu hình Auto) vẫn theo từng trình duyệt — không thuộc DB
- ⚠ KHÔNG gộp khi instance nằm trên KHÁC máy (SQLite là file) — khi đó dùng `sync-db-from-vps.sh`

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
- **Env Telegram (nhét cứng):** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_API_BASE` (tùy chọn — proxy chống 503, xem §6b). Env là fallback: giá trị dán trong panel Auto (runtime) vẫn thắng nếu có cả hai.
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

## 6b. Fix lỗi Telegram 503 — proxy Bot API qua Cloudflare Worker (5 phút)

**Chẩn đoán trước khi làm:** gọi POST trên server (hoặc chỉ đọc log):

```bash
curl -sS -m 8 https://api.telegram.org/   # vào được JSON = mạng OK
curl -sS -m 8 -X POST https://api.telegram.org/bot123:DEAD/getMe   # 401 = đường sống, token sai
```

App tự kiểm tra từ phía server mỗi lần gửi: DNS, **IPv4 ưu tiên trước** (né VPS IPv6 hỏng), retry 3 lần. Log server bản mới in rõ nguyên nhân: `[telegram] sendMessage via https://api.telegram.org failed after 3 attempt(s): fetch failed (ECONNRESET …)`. Kết luận: IPv6 hỏng (bản mới tự ưu tiên IPv4 — chỉ cần `update.sh`), đường mạng bị chặn cả 2 (→ bắt buộc dùng Worker bên dưới), hay token sai.

**Triệu chứng:** panel Auto báo `Telegram is overloaded (503)` dù token hợp lệ — lặp lại nhiều ngày. Nguyên nhân: **đường mạng từ server app → api.telegram.org** bị nghẽn/throttled (rất thường gặp với IP VPS/datacenter và một số ISP), không phải lỗi token.

**Cách chạy đã có sẵn trong app:** mọi call Bot API đi qua `tgApi()` (retry 3 lần, tôn trọng `retry_after`) và đọc origin từ biến env `TELEGRAM_API_BASE` — có thể trỏ sang 1 **Worker proxy trên chính account Cloudflare** của bạn:

1. Cloudflare Dashboard → **Workers & Pages → Create → Worker** → Deploy → **Edit code** → dán nguyên file [`deploy/tg-proxy-worker.js`](deploy/tg-proxy-worker.js) → Deploy
2. Copy URL miễn phí `https://<tên-worker>.<account>.workers.dev` (hoặc gắn custom domain `tg.huyenbao.com` trong Settings → Domains & Routes)
3. Ghi vào .env: `sudo bash deploy/set-telegram-env.sh - - https://<tên-worker>.<account>.workers.dev` rồi restart app (xoá trắng = về `api.telegram.org`)
4. Không cần nhập lại token — token vẫn nằm ở server app, Worker chỉ chuyển tiếp path verbatim và **không lưu gì**

Kiểm tra Worker sống: `curl https://<worker-url>/health` → `ok`.

### “fetch failed” ≠ 503 — server KHÔNG kết nối nổi tới Telegram

`Telegram error: fetch failed` nghĩa là server không mở được kết nối nào tới Bot API (khác hẳn 503 — kết nối được nhưng Telegram từ chối). Log server bản mới sẽ chỉ nguyên nhân thật thay vì chỉ “fetch failed”:

```
[telegram] sendMessage via https://api.telegram.org failed after 3 attempt(s): fetch failed (ECONNRESET)
```

- `ENOTFOUND` → DNS hỏng; `ECONNREFUSED` → có proxy/localhost sai (bản mới **tự bỏ qua** API base trỏ vào chính app, ví dụ `http://localhost:3000`, kèm cảnh báo);
- `ECONNRESET` / `ETIMEDOUT` / `ENETUNREACH` → đường mạng bị chặn/throttle → làm mục **Chẩn đoán** ở trên; nếu bị chặn hẳn → dùng Worker proxy (bước 1-4 phía trên) rồi ghi URL Worker vào `.env`: `sudo bash deploy/set-telegram-env.sh - - https://<worker>.workers.dev`.

Test nhanh từ VPS (không cần token):

```bash
curl -sS -m 8 https://api.telegram.org/          # vào được = mạng OK
# hết hạn/timeout/reset → VPS bị chặn Telegram → dùng Worker proxy ở trên
```

Lưu ý cấu hình sẵn trong app (không cần làm gì): tự đọc `.env` kể cả khi chạy standalone tay, tự ưu tiên **IPv4-first** (né VPS có IPv6 hỏng), tự retry 3 lần với backoff.

## 6c. Thông báo đầu phiên (tự động, không cần bật gì)

Mỗi phiên toàn cầu **sắp mở** — app tự gửi 1 tin **trước giờ mở 5 phút**: Sydney 03:55, Tokyo 06:55, London 13:55, New York 18:55 giờ VN (phiên mở lúc 04:00 / 07:00 / 14:00 / 19:00 — 21:00 / 00:00 / 07:00 / 12:00 UTC). Tin vào kênh Telegram đã cấu hình trong `.env`, tiêu đề "⏳ SẮP MỞ PHIÊN …" kèm đếm ngược, nội dung đúng như panel "Phiên giao dịch": Bull% / drift từng phiên, phiên nào đang mở/đóng, dự báo cho phiên sắp mở (thiên LONG/SHORT, P≈%, số nến lịch sử) — tính từ nến **BTCUSDT 1h** lấy thẳng từ Binance. Kèm thêm **dự báo chu kỳ lịch** (block 📅): chiều (TĂNG/GIẢM) và volume (tăng/giảm) theo **thứ trong tuần / đầu tháng / cuối tháng / cuối quý**, thống kê tần suất từ **nến 1d BTCUSDT ~2.7 năm** (mỗi thứ ~140 mẫu); đúng cửa sổ đặc biệt thì thêm dòng "Cuối tháng/Cuối quý (n=…)" — panel "Phiên giao dịch" cũng hiển thị block "Chu kỳ lịch" tương tự. Lấy nến 1d thất bại thì tin vẫn gửi, chỉ bỏ block 📅 (fail-open).

- Chạy **phía server** (timer trong `instrumentation.ts` → `src/lib/session-broadcast.ts`) — không cần mở trình duyệt, hoạt động 24/7 trên VPS
- Tự chống gửi trùng: trạng thái lưu `db/session-bcast.json` (hoặc `$DATA_DIR`) theo **ngày mở phiên** — restart app không gây gửi lại; tin "trước 5 phút" đã gửi thì tin lúc mở phiên tự bị bỏ. Cửa sổ gửi: từ **5 phút trước** đến **10 phút sau** giờ mở — server chết rồi khởi động lại trong cửa sổ này vẫn gửi bù (tiêu đề chuyển thành "🚦 ĐẦU PHIÊN … VỪA MỞ"), trễ hơn thì bỏ qua
- Điều kiện duy nhất: `.env` đã có `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (chưa có thì im lặng, không lỗi)

**Test thủ công 1 tin** (không đợi giờ mở phiên): thêm dòng `SESSION_BCAST_FORCE=1` vào `.env` → restart app → sau ~20 giây có 1 tin 🧪 xem trước (không ảnh hưởng chống trùng). Xong thì xoá dòng đó đi.

## 7. Bảo vệ source code (đã bật)

- **Sourcemap luôn bị xóa** trong mọi bản build production (`scripts/postbuild.mjs`)
- **Obfuscate:** `bun run build:secure` — hex identifiers + string array trên toàn bộ server bundle; artifact production không đọc được như source
- **VPS/tunnel:** code không bao giờ rời server — browser chỉ nhận HTML/CSS/JS đã compile
- **Repo:** cân nhắc chuyển **Private** trong GitHub Settings (lưu ý: platform deploy phải vẫn truy cập được repo sau khi chuyển)
- **LICENSE:** proprietary — mọi sao chép/sửa/phân phối không được phép
- Git đã loại `.env`, `db/`, `data/`, token Telegram khỏi repo (`.gitignore`)
