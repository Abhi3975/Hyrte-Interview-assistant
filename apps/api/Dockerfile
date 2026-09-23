# ── Multi-stage build for the NestJS API ──
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# ── deps: install with the schema present so `prisma generate` can run ──
FROM base AS deps
COPY package.json package-lock.json* ./
# Workspace package consumed as source by both apps — must exist before install
# so npm can link it (see packages/conversation/README.md).
COPY packages ./packages
COPY apps/api/package.json apps/api/package.json
COPY prisma ./prisma
RUN npm install --workspace @interviewai/api --include-workspace-root

# ── build ──
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages ./packages
COPY prisma ./prisma
COPY apps/api ./apps/api
RUN npx prisma generate --schema=prisma/schema.prisma
# The shared package ships compiled JS: node_modules/@interviewai/conversation
# is a symlink into packages/, and Node cannot require TypeScript at runtime.
RUN npm run build --workspace @interviewai/conversation
RUN npm run build --workspace @interviewai/api

# ── runtime: slim, non-root ──
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
# Without this the symlink above dangles and the API exits 1 on boot with
# "Cannot find module '@interviewai/conversation'" — which is exactly what
# happened, because the image building was mistaken for the container starting.
COPY --from=build /app/packages ./packages
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/package.json ./package.json

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 4000
# Migrations are applied by a K8s init container / CI step, not here.
CMD ["node", "dist/main.js"]
