# ── Elliott Paper Trading — standalone production image ──────────────────────
# Build:  docker build -t elliott .
#         (mã hóa bundle: docker build --build-arg OBFUSCATE=1 -t elliott .)
# Run:    docker run -d -p 3000:3000 -v elliott-data:/app/data \
#           -e DATABASE_URL="file:/app/data/custom.db" \
#           -e DATA_DIR=/app/data elliott
#
# The final image ships ONLY the built standalone bundle — no source maps,
# no build tooling (see scripts/postbuild.mjs; obfuscation is opt-in).

# ── 1. dependencies ──────────────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

# ── 2. build (prisma generate → next build → postbuild) ───────────────────────
FROM oven/bun:1 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG OBFUSCATE=0
ENV OBFUSCATE=${OBFUSCATE}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# ── 3. runner — built standalone only ────────────────────────────────────────
FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/app/data/custom.db \
    DATA_DIR=/app/data

# standalone output already contains .next + public + traced node_modules
COPY --from=builder /app/.next/standalone ./

RUN mkdir -p /app/data
VOLUME /app/data
EXPOSE 3000

CMD ["bun", "server.js"]
