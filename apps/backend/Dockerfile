# Stage 1: base
FROM node:22-alpine AS base
RUN npm install -g pnpm
WORKDIR /app

# Stage 2: deps
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
RUN pnpm install --frozen-lockfile --filter @job-search/backend

# Stage 3: build
FROM deps AS build
COPY apps/backend ./apps/backend
RUN pnpm --filter @job-search/backend run build
RUN pnpm --filter @job-search/backend prisma generate

# Stage 4: runner
FROM node:22-alpine AS runner
RUN npm install -g pnpm
WORKDIR /app

COPY --from=build /app/apps/backend/dist ./dist
COPY --from=build /app/apps/backend/node_modules ./node_modules
COPY --from=build /app/apps/backend/package.json ./package.json
COPY --from=build /app/apps/backend/src/database/schema.prisma ./schema.prisma

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main"]
