# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# corepack provisions the pnpm version pinned in package.json's packageManager field
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env (no secrets)
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Signal to next.config.ts to enable output:standalone (required for Docker runner stage)
ENV DOCKER_BUILD=1
ENV MODE=standalone

# Dummy secret satisfies the ≥32-char validation during `next build` page-data collection.
# This value is never baked into the image — SESSION_SECRET is supplied at runtime via env/secret.
# Using ARG avoids the Docker SecretsUsedInArgOrEnv warning for ENV.
ARG SESSION_SECRET=00000000000000000000000000000000

RUN SESSION_SECRET=${SESSION_SECRET} pnpm run build

# ── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# MED-001: Run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Only copy the standalone output + static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
