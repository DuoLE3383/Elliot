# Elliott Paper Trading

Cryptocurrency paper-trading application built with Next.js. It simulates trades from **UT Bot + SMA gate** signals, includes **Wyckoff** analysis, a pure-TypeScript **XGBoost** suggestion engine, automatic dry-run trading, and Telegram alerts. All price data comes directly from the Binance REST API — no API key required.

> The UI is fully bilingual (**English / Vietnamese**). Language can be switched from the header at any time. **English is the default**.

## Main features

- **Interactive price chart** — candles, SMA/EMA, BUY/SELL markers, ENTRY / FLIP / SL / TP levels, pin signals for inspection.
- **Multi-pair watchlist** — add/remove pairs (defaults to major USDT-M symbols), live ticker strip, periodic refresh.
- **UT Bot + SMA gate** — every signal shows why it was allowed or blocked by the directional SMA filter.
- **Deep Analysis panel** — breakout / inside / breakdown structure, RSI(14), EMA50/200, volume ratio, ATR% vs 50-candle average (calculated on closed candles only).
- **Wyckoff panel** — phase detection (accumulation / distribution), swing pivots, events and trend stages.
- **XGBoost suggestions** — pure-TypeScript XGB model trained in the browser or on the server; each train produces a bias (LONG / SHORT / NEUTRAL), probability, SL/TP and horizon; results are scored win/loss after the horizon.
- **Finetune & history** — track accuracy / AUC across finetune runs and compare model performance.
- **Auto-trade (dry-run)** — state machine that opens/closes positions from signals, respects session time windows, risk controls, and pushes digests + trade alerts via Telegram.
- **Trade journal + Equity curve + KPI** — win rate, PnL, strategy allocation pies, session breakdown.
- **Flexible settings** — global settings dialog, show/hide panels via the rail, responsive mobile layout.
- **Stats page** — consistency checks, per-pair / all-pairs journal aggregation, deep analysis, session and universe scan summaries.
- **Open-position strip** — live dry-run position shown at the top of the home page with real-time ROE, SL→TP progress and one-click jump to the chart.

## Tech stack

| Layer        | Technology                                      |
|--------------|-------------------------------------------------|
| Framework    | Next.js 16 (App Router) · React 19 · TypeScript |
| UI           | Tailwind CSS 4 · shadcn/ui (Radix)              |
| Charts       | Lightweight Charts (candles, equity, pies)      |
| Database     | Prisma ORM 6 · SQLite (local file)              |
| ML           | Pure-TypeScript XGBoost (`src/lib/xgb.ts`)      |
| Runtime      | Bun (recommended) or Node.js ≥ 20               |

## Directory layout

```
src/
├── app/
│   ├── api/              # klines, ticker, autotrade, telegram, finetune, journal…
│   ├── layout.tsx        # document shell + fonts + theme
│   ├── page.tsx          # main dashboard
│   ├── stats/            # statistics & consistency page
│   └── ai/               # AI / strategy-lab views
├── components/
│   ├── price-chart.tsx
│   ├── open-position-strip.tsx
│   ├── auto-panel.tsx
│   ├── journal.tsx
│   ├── xgb-panel.tsx
│   ├── wyckoff-panel.tsx
│   └── ui/               # shadcn/ui primitives
├── lib/
│   ├── signals.ts        # UT Bot + SMA gate
│   ├── papers.ts         # paper-trade simulation & KPI
│   ├── autotrade.ts      # auto-trade state machine
│   ├── autostate.ts      # persistence helpers
│   ├── xgb.ts            # XGBoost implementation
│   ├── i18n.ts           # English / Vietnamese dictionaries
│   └── db.ts             # Prisma client
└── scripts/              # build helpers, deploy utilities
```

## Quick start

```bash
# 1. Install dependencies
bun install          # or: npm install

# 2. Environment
cp .env.example .env
#    DATABASE_URL defaults to file:./db/custom.db

# 3. Database
bunx prisma db push  # or: npm run db:push

# 4. Development server
bun run dev          # or: npm run dev  →  http://localhost:3000

# 5. Production build
bun run build && bun run start
```

## Telegram (optional)

Fill the two variables in `.env`:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...   # channel id (-100…) or public @name / t.me link
```

Restart the process after changing them. See `DEPLOY.md` for production setup, Cloudflare tunnel, and proxy notes.

## License

See [LICENSE](LICENSE).
