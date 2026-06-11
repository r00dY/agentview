# syntax=docker/dockerfile:1
#
# Image for the stress-2 test harness (apps/tests/src/stress-2).
# Used by BOTH stress-2 services (see src/stress-2/render.yaml):
#   - agent endpoint:  pnpm stress2:agent   (default CMD)
#   - test runner box: sleep infinity, then SSH in and `pnpm stress2 [N]`
#
# Build context is the REPO ROOT. The root .dockerignore excludes apps/tests
# and packages/studio, so this build relies on the sibling
# `Dockerfile.dockerignore` (BuildKit prefers it over the root one).

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

# Disable pnpm's verify-deps-before-run check (default "install" since pnpm 11).
# On cached rebuilds the COPY'd source layers have fresher mtimes than the
# cached `pnpm install` layer, so any `pnpm <script>` triggers an implicit
# NON-frozen install. That install fails with ERR_PNPM_UNUSED_PATCH: the
# ai@6.0.158 patch only applies via apps/api, which is excluded from this
# image. Deps are baked at build time, so the check is useless here anyway.
# (Must be .npmrc — the npm_config_* env var is ignored for this setting.)
RUN echo "verify-deps-before-run=false" >> .npmrc

# Copy package.json files for dependency resolution (apps/tests + its
# workspace dependency closure)
COPY apps/tests/package.json ./apps/tests/
COPY packages/agentview/package.json ./packages/agentview/
COPY packages/utils/package.json ./packages/utils/
COPY packages/studio/package.json ./packages/studio/
COPY packages/zod-from-json-schema/package.json ./packages/zod-from-json-schema/

# Install all deps
RUN pnpm install --frozen-lockfile

# Copy source files
COPY apps/tests ./apps/tests
COPY packages/agentview ./packages/agentview
COPY packages/utils ./packages/utils
COPY packages/studio ./packages/studio
COPY packages/zod-from-json-schema ./packages/zod-from-json-schema

# Build zod-from-json-schema (the only package that needs to be built)
RUN pnpm --filter zod-from-json-schema build

# ---------- Runtime ----------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Copy the entire built workspace (node_modules + source) from the build stage.
COPY --from=build /app /app

# Use non-root user
RUN useradd -m nodeuser && chown -R nodeuser:nodeuser /app
USER nodeuser

WORKDIR /app/apps/tests
ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["pnpm", "stress2:agent"]
