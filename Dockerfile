# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps (same toolchain caveat as the runner stage below)
COPY package*.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++   && npm ci   && apk del .build-deps

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: production ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Only copy production deps + built output.
#
# better-sqlite3 is a native module and this base image is alpine (musl), which
# its prebuilds do not always cover — when they don't, npm has to compile it,
# and a bare node:20-alpine has no toolchain. Installing one as a virtual
# package and dropping it again keeps the final image the same size while
# making the install work whether or not a prebuild exists. (Without this, a
# driver upgrade builds green and then fails at container start.)
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
