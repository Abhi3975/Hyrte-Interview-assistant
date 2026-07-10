# ── Multi-stage build for the Next.js web app ──
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
RUN npm install --workspace @interviewai/web --include-workspace-root

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @interviewai/web

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/package.json ./package.json

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "@interviewai/web"]
