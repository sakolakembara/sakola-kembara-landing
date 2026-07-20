# Multi-stage build for Next.js 16 standalone output (~150 MB final image).
# Relies on `output: "standalone"` in next.config.ts.

# ----------------------------------------------------------------------------
# 1. deps — install production + dev dependencies for the build
# ----------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Install OS deps that node-gyp / sharp / pg might need on Alpine.
RUN apk add --no-cache libc6-compat
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ----------------------------------------------------------------------------
# 2. builder — build the Next standalone bundle
# ----------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN corepack enable && pnpm run build

# ----------------------------------------------------------------------------
# 3. runner — minimal runtime image
# ----------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
	adduser --system --uid 1001 nextjs

# public/ ships baked in; on the VPS it's overlaid by a persistent volume so
# dashboard uploads (PDFs, hero images) survive deploys.
COPY --from=builder /app/public ./public

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
