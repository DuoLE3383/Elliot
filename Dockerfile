# ── Elliott Paper Trading — standalone production image ──────────────────────
# Build:  docker build -t elliott .
# Run:    docker run -d -p 3000:3000 -v elliott-db:/app/db -e DATABASE_URL="file:/app/db/custom.db" elliott
#
# The final image ships ONLY the obfuscated standalone bundle — no source,
# no sourcemaps, no build tooling (see scripts/obfuscate.mjs).

# ── 1. dependencies ──────────────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

# ── 2. build (prisma generate → next build → obfuscate) ─────────────────────
FROM oven/bun:1 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# ── 3. runner — obfuscated standalone only ───────────────────────────────────
FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/app/db/custom.db

# standalone output already contains .next (obfuscated) + public + traced node_modules
COPY --from=builder /app/.next/standalone ./

RUN mkdir -p /app/db
VOLUME /app/db
EXPOSE 3000

CMD ["bun", "server.js"]
