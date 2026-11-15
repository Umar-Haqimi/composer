# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

# Install dependencies first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

# VITE_* values are inlined at build time, so they are build args.
# See .env.example for what each one does.
ARG VITE_COBALT_API_URL=https://cobalt.boidu.dev
ARG VITE_TURNSTILE_SITEKEY=
ARG VITE_VOCAL_MODEL_BASE_URL=
ARG VITE_ALIGNMENT_MODEL_MANIFEST_URL=
ENV VITE_COBALT_API_URL=$VITE_COBALT_API_URL \
    VITE_TURNSTILE_SITEKEY=$VITE_TURNSTILE_SITEKEY \
    VITE_VOCAL_MODEL_BASE_URL=$VITE_VOCAL_MODEL_BASE_URL \
    VITE_ALIGNMENT_MODEL_MANIFEST_URL=$VITE_ALIGNMENT_MODEL_MANIFEST_URL

RUN pnpm build

# ---- Runtime stage ----
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
