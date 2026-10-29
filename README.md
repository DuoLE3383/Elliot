# Elliott Paper Trading

Ứng dụng paper trading tiền điện tử chạy trên nền Next.js — mô phỏng lệnh theo tín hiệu **UT Bot + cổng SMA**, tích hợp phân tích **Wyckoff**, bộ đề xuất **XGBoost (XGB) thuần TypeScript**, giao dịch tự động (auto-trade) kèm đẩy cảnh báo qua **Telegram**. Toàn bộ dữ liệu giá lấy trực tiếp từ REST API Binance, không cần API key.

> Ứng dụng hỗ trợ song ngữ **Tiếng Việt / English** (chuyển đổi ngay trên thanh header).

## Tính năng chính

- **Biểu đồ giá tương tác** — nến SMA/EMA, đánh dấu tín hiệu BUY/SELL, các mức VÀO / ĐẢO / SL / TP, ghim tín hiệu để theo dõi.
- **Watchlist đa cặp** — thêm/xóa pair (mặc định BTCUSDT…), ticker chạy realtime, tự làm mới theo chu kỳ.
- **Tín hiệu UT Bot + cổng SMA** — mỗi tín hiệu đều hiển thị lý do bị chặn/cho phép (blocked bởi SMA filter) ngay trên biểu đồ.
- **Phân tích sâu (Analysis panel)** — cấu trúc breakout/inside/breakdown, RSI(14), EMA50/200, tỷ lệ volume, ATR% so với trung bình 50 nến — chỉ tính trên nến đã đóng nên không bị nhấp nháy.
- **Wyckoff panel** — phân đoạn pha (accumulation/distribution), phát hiện swing pivot, sự kiện và giai đoạn xu hướng.
- **XGBoost đề xuất (Suggestions)** — huấn luyện mô hình XGB ngay trên trình duyệt/server bằng TypeScript thuần, mỗi lần train sinh ra một đề xuất (bias LONG/SHORT/NEUTRAL, xác suất, SL/TP, horizon) và được chấm điểm win/loss khi hết horizon.
- **Finetune & lịch sử** — theo dõi accuracy/AUC qua các lần finetune, so sánh hiệu năng mô hình.
- **Auto-trade** — máy trạng thái tự động vào/đóng vị theo tín hiệu, giới hạn khung giờ phiên, kiểm soát rủi ro, đẩy digest và lệnh qua Telegram bot.
- **Nhật ký giao dịch (Journal) + Equity curve + KPI** — win rate, PnL, phân bổ chiến lược (strategy pies), giao dịch theo phiên (sessions).
- **Cài đặt linh hoạt** — dialog cài đặt chung, ẩn/hiện panel theo rail, layout mobile responsive.

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Framework | Next.js 16 (App Router) · React 19 · TypeScript |
| UI | Tailwind CSS 4 · shadcn/ui (Radix) |
| Biểu đồ | Lightweight Charts (nến, equity curve, pies) |
| CSDL | Prisma ORM 6 · SQLite (file local) |
| ML | XGBoost tự cài đặt bằng TypeScript (`src/lib/xgb.ts`) |
| runtime | Bun (khuyến nghị) hoặc Node.js ≥ 20 |

## Cấu trúc thư mục

```
src/
├── app/
│   ├── api/              # klines, ticker, autotrade, telegram, finetune, suggestions…
│   ├── layout.tsx        # shell + fonts + theme
│   └── page.tsx          # trang chính (dashboard)
├── components/
│   ├── price-chart.tsx   # biểu đồ nến + tín hiệu
│   ├── watchlist.tsx     # danh sách pair + ticker
│   ├── xgb-panel.tsx     # huấn luyện/finetune XGB
│   ├── wyckoff-panel.tsx # phân tích Wyckoff
│   ├── auto-panel.tsx    # điều khiển auto-trade
│   ├── journal.tsx       # nhật ký lệnh
│   ├── equity-curve.tsx  # đường vốn
│   ├── kpi.tsx           # dải KPI
│   └── ui/               # bộ shadcn/ui
├── lib/
│   ├── signals.ts        # UT Bot + SMA gate
│   ├── wyckoff.ts        # Wyckoff engine
│   ├── xgb.ts            # XGBoost TS
│   ├── autotrade.ts      # máy trạng thái auto-trade
│   ├── market.ts         # Binance REST wrapper
│   ├── indicators.ts     # EMA/SMA/RSI/ATR
│   ├── i18n.ts           # song ngữ vi/en
│   └── db.ts             # Prisma client
└── hooks/                # use-toast, use-mobile
```

## Cài đặt & chạy

```bash
# 1. Cài phụ thuộc
bun install        # hoặc: npm install

# 2. Tạo file môi trường
cp .env.example .env
#    DATABASE_URL mặc định: file:./db/custom.db (thư mục db/ tự tạo khi chạy prisma)

# 3. Khởi tạo CSDL
bunx prisma db push       # hoặc: npm run db:push

# 4. Chạy môi trường dev
bun run dev               # hoặc: npm run dev  →  http://localhost:3000

# 5. Build production (tùy chọn)
bun run build && bun run start
```

### Biến môi trường

| Biến | Bắt buộc | Mô tả |
|---|---|---|
| `DATABASE_URL` | ✅ | Chuỗi kết nối SQLite, ví dụ `file:./db/custom.db` |

API key sàn **không cần thiết** — dữ liệu giá dùng endpoint public của Binance. Telegram bot token / chat ID được cấu hình ngay trong ứng dụng (menu Cài đặt) và lưu trong CSDL local, không nằm trong repo.

## API nội bộ

| Route | Chức năng |
|---|---|
| `GET /api/klines` | Proxy nến giá từ Binance (symbol, interval, limit) |
| `GET /api/ticker` | Giá 24h cho watchlist/ticker strip |
| `GET/POST /api/autotrade` | Trạng thái & điều khiển máy auto-trade |
| `POST /api/autotrade/push` | Webhook đẩy tín hiệu/digest từ server |
| `GET/POST /api/telegram` | Gửi tin nhắn qua Telegram bot (GET trả trạng thái wiring) |
| `POST /api/telegram/discover` | Dò chat_id khả dụng (getMe + getUpdates) |
| `GET/POST/DELETE /api/telegram/token` | Nhập/xóa bot token ngay trong app (validate qua getMe) |
| `GET/POST /api/finetune` | Lưu/đọc lịch sử finetune XGB |
| `GET/POST /api/suggestions` | Đề xuất XGB + chấm điểm kết quả |

## Deploy & bản quyền

- Xem **[DEPLOY.md](DEPLOY.md)**: build pipeline cho CI (prisma generate đã fix), Dockerfile chạy độc lập, Railway/Render/Fly/VPS, và giới hạn thực tế khi chạy trên Cloudflare edge.
- Bản production được **obfuscate tự động** lúc build (`scripts/obfuscate.mjs`) — server bundle không đọc được và không có sourcemap.
- Phần mềm proprietary — xem [LICENSE](LICENSE).

## Lưu ý

- Đây là công cụ **paper trading / mô phỏng** phục vụ nghiên cứu chiến lược — không phải tư vấn đầu tư. Auto-trade chỉ thao tác trên sổ mô phỏng nội bộ, không nối sàn để đặt lệnh thật.
- CSDL SQLite nằm ngoài git (`db/`), mỗi môi trường chạy tự khởi tạo riêng bằng `prisma db push`.
- File `.env`, log, và dữ liệu runtime đều đã được `.gitignore` loại khỏi repo — đừng commit bí mật vào git.
