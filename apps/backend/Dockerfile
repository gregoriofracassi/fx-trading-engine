# Stage 1: base
FROM node:22-alpine AS base
RUN npm install -g pnpm
WORKDIR /app

# Stage 2: deps
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
RUN pnpm install --frozen-lockfile --filter @fx-trading/backend

# Stage 3: build
FROM deps AS build
COPY apps/backend ./apps/backend
# Generate Prisma client
RUN pnpm --filter @fx-trading/backend exec prisma generate --schema=/app/apps/backend/src/database/schema.prisma
RUN pnpm --filter @fx-trading/backend run build
# Flatten prod deps for the runner
RUN pnpm --filter @fx-trading/backend deploy --prod /app/deploy

# Stage 4: runner
FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app

COPY --from=build /app/deploy ./
COPY --from=build /app/apps/backend/dist ./dist
COPY --from=build /app/apps/backend/src/database/schema.prisma ./schema.prisma
COPY --from=build /app/apps/backend/src/database/migrations ./migrations
# Copy generated Prisma client artifacts
COPY --from=build /app/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client /app/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main"]
