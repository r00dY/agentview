# syntax=docker/dockerfile:1

# ---------- Base ----------
FROM node:24-slim AS base
WORKDIR /app

# Install tini for proper signal handling and pnpm
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@11.5.2

# ---------- Builder ----------
FROM base AS build

# Copy workspace config for pnpm
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY patches ./patches

# Copy package.json files for dependency resolution
COPY apps/api/package.json ./apps/api/
COPY packages/agentview/package.json ./packages/agentview/
COPY packages/utils/package.json ./packages/utils/
COPY packages/zod-from-json-schema/package.json ./packages/zod-from-json-schema/

# Install all deps
RUN pnpm install --frozen-lockfile

# Copy source files
COPY apps/api ./apps/api
COPY packages/agentview ./packages/agentview
COPY packages/utils ./packages/utils
COPY packages/zod-from-json-schema ./packages/zod-from-json-schema

# Build zod-from-json-schema (the only package that needs to be built)
RUN pnpm --filter zod-from-json-schema build

# ---------- Runtime ----------
FROM base AS runtime
ENV NODE_ENV=production

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY patches ./patches
COPY apps/api/package.json ./apps/api/
COPY packages/agentview/package.json ./packages/agentview/
COPY packages/utils/package.json ./packages/utils/
COPY packages/zod-from-json-schema/package.json ./packages/zod-from-json-schema/

# Install production deps only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/packages/agentview ./packages/agentview
COPY --from=build /app/packages/utils ./packages/utils
COPY --from=build /app/packages/zod-from-json-schema ./packages/zod-from-json-schema

# Use non-root user
RUN useradd -m nodeuser && chown -R nodeuser:nodeuser /app
USER nodeuser

WORKDIR /app/apps/api
ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["pnpm", "run", "http"]