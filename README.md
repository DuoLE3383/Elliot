# Elliott Paper Trading

Cryptocurrency paper-trading application built with Next.js. It simulates trades from **UT Bot + SMA gate** signals, includes **Wyckoff** analysis, a pure-TypeScript **XGBoost** suggestion engine, automatic dry-run trading, and Telegram alerts. All price data comes directly from the Binance REST API — no API key required.

> The UI is fully bilingual (**English / Vietnamese**). Language can be switched from the header at any time. **English is the default**.

## Main features

- **Interactive price chart** — candles, SMA/EMA, BUY/SELL markers, ENTRY / FLIP / SL / TP levels, pin signals for inspection.
- **Multi-pair watchlist** — add/remove pairs (defaults to major USDT-M symbols), live ticker strip, periodic refresh.
- **UT Bot + SMA gate** — every signal shows why it was allowed or blocked by the directional SMA filter.
- **Deep Analysis panel** — breakout / inside / breakdown structure, RSI(14), EMA89/200, volume ratio, ATR% vs 50-candle average (calculated on closed candles only; lives on the stats page's Analysis tab alongside the strategy-potential pies).
- **Wyckoff panel** — phase detection (accumulation / distribution), swing pivots, events and trend stages.
- **XGBoost suggestions** — pure-TypeScript XGB model trained in the browser or on the server; each train produces a bias (LONG / SHORT / NEUTRAL), probability, SL/TP and horizon; results are scored win/loss after the horizon.
- **Finetune & history** — track accuracy / AUC across finetune runs and compare model performance.
- **Auto-trade (dry-run)** — state machine that opens/closes positions from signals, respects session time windows, risk controls, and pushes digests + trade alerts via Telegram. Lives on its own `/auto` page; that page also hosts the Binance API settings (key/secret stored server-side with a read-only signed `/fapi/v2/account` connection test — dry-run stays simulated, keys are staged for a future live mode).
- **Strategy arena A/B/C (0.2.97)** — three parallel paper books from the same starting capital: A = Vulcan/Donchian 15m breakout, B = Elliott XGB engine, C = ORIGINAL Wyckoff 5-layer funnel ported from `WyckoffTradingAgent` (daily candles, long-only, lev 1: L1 liquidity → L2 markup/RPS → L3 breadth resonance → L4 Spring/SOS/EVR/TrendPullback → L5 structural stop −7% under the 60-day base, trailing after +15%, Upthrust/Distribution/RISK_OFF exits; LPS + Compression stay OFF exactly like the original production config). `/auto` shows per-book on/off toggles, stats and a data-driven recommendation; `/arena` compares all three plus the LIVE book.
- **DRY-RUN / LIVE switch (0.2.97)** — ledger B has a START/STOP control and a DRY-RUN|LIVE mode switch on `/auto`. LIVE mirrors every ledger-B paper open/close/flip as a real MARKET order on Binance USDT-M (qty rounded via exchangeInfo, minNotional guard, balance read from `/fapi/v2/account`), records fills in the `LiveBook` table, requires configured + tested keys and a typed "LIVE" confirmation, and never blocks the dry-run cycle on failure.
- **Detailed auto analytics (0.2.97)** — ledger-B analytics on `/auto`: expectancy, profit factor, max drawdown, average hold, win/loss streaks, capital curve, and breakdowns by exit reason / symbol / timeframe / side, computed server-side from the full closed history.
- **Universe lives in the watchlist (0.2.97)** — the 8-hour ATR + trending ranking moved from the auto panel to the dashboard watchlist; suggested pairs are added to the watchlist manually (one click), no longer auto-merged.
- **Wyckoff LONG gate (book B)** — before any LONG opens, the engine requires a valid 90-day accumulation range (width 4–45%, drift ≤18%, ≥2 boundary tests), a Spring/SOS trigger on the last closed daily candle, market breadth (universe symbols above MA20) ≥ 50%, and vetoes failed breakouts (Upthrust). Thresholds ported 1:1 from a walk-forward verification (`scripts/verify-wyckoff-crypto.py`: gate +3.87%/58.7% vs −0.14%/45.6% baseline; cross-checked TS↔Python over 3,970 range-days with zero mismatches). Runtime-tunable on `/ai` (group "Wyckoff gate"); data errors fail open.
- **Trade journal + Equity curve + KPI** — win rate, PnL, strategy allocation pies, session breakdown (interactive journal table with filters + CSV export lives on the stats page, sharing the same `/api/journal` source as the KPI tiles).
- **Flexible settings** — global settings dialog, show/hide panels via the rail, responsive mobile layout.
- **Stats page (full width)** — consistency checks, per-pair / all-pairs journal aggregation with the interactive trade journal (filters + CSV) merged into the journal card, plus the terminal tabs (Suggestions / Lab / Analysis) moved from the home page: suggestion history with scope + filters + CSV, the Strategy Lab A/B variants, and Deep Analysis + strategy pies — all driven by the same pair/TF picker; session and universe scan summaries.
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
