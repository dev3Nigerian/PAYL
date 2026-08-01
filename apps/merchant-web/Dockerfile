FROM node:24-alpine AS build

RUN npm install --global pnpm@11.9.0
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/approval-web/package.json apps/approval-web/package.json
COPY apps/merchant-web/package.json apps/merchant-web/package.json
COPY apps/reference-agent/package.json apps/reference-agent/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/crypto/package.json packages/crypto/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @payl/merchant-web build

FROM node:24-alpine
WORKDIR /app/apps/merchant-web
COPY --from=build --chown=node:node /app/apps/merchant-web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/merchant-web/.next/static ./apps/merchant-web/.next/static

ENV NODE_ENV=production
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 10000
USER node
CMD ["node", "apps/merchant-web/server.js"]
