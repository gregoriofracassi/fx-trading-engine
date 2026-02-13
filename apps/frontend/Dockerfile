# Stage 1: base
FROM node:22-alpine AS base
RUN npm install -g pnpm
WORKDIR /app

# Stage 2: deps
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/frontend/package.json ./apps/frontend/
RUN pnpm install --frozen-lockfile --filter @job-search/frontend

# Stage 3: build
FROM deps AS build
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY apps/frontend ./apps/frontend
RUN pnpm --filter @job-search/frontend run build

# Stage 4: runner — static files served by nginx
FROM nginx:alpine AS runner
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
