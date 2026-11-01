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

```bash
cd /opt/elliott
git pull
bun install          # or npm install
bun run build        # or npm run build
sudo systemctl restart elliott
```

If you use pm2 instead of systemd:

```bash
git pull && npm run build && pm2 restart elliott --update-env && pm2 flush
```

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
