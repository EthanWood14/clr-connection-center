# ── Stage 1: build ────────────────────────────────────────────────────────────
# Node 22, not 20. better-sqlite3 12.x publishes prebuilds only from ABI 127
# (Node 22) upward — there is no Node 20 build, glibc or musl. On node:20-alpine
# npm therefore had nothing to fetch, which is how a driver upgrade produced an
# image that built green and then could not start. Node 20 also went EOL in
# April 2026. On Node 22 the linuxmusl-x64 prebuild applies and nothing is
# compiled at deploy time.
#
# The toolchain below is insurance, not the normal path: with a matching
# prebuild npm never uses it. It is kept so that a future version bump which
# drops prebuilds degrades into a slower build rather than a broken image.
FROM node:22-alpine AS builder
WORKDIR /app

# Install deps
COPY package*.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci \
  && apk del .build-deps

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: production ────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Only copy production deps + built output
COPY package*.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci --omit=dev \
  && apk del .build-deps

COPY --from=builder /app/dist ./dist

# The DB lives on a mounted volume at /data in production
# (falls back to ./clr.db locally)
ENV DATABASE_PATH=/data/clr.db
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.cjs"]
