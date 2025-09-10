# syntax=docker/dockerfile:1

# ---------- Base deps ----------
FROM node:20-slim AS base
WORKDIR /app

# Install tini for proper signal handling
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

# ---------- Builder ----------
FROM base AS build

# Install dependencies separately for better caching
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Copy sources and build
COPY tsconfig.json ./
COPY src ./src
COPY drizzle.config.ts ./drizzle.config.ts
COPY scripts ./scripts

# no build for now, we'll just run start-ts
RUN npm run build

# ---------- Runtime ----------
FROM base AS runtime
ENV NODE_ENV=production

WORKDIR /app

# Only production deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built app
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts

# Copy sources for no-build start-ts
COPY --from=build /app/src ./src

# Use non-root user
RUN useradd -m nodeuser && chown -R nodeuser:nodeuser /app
USER nodeuser

# EXPOSE 80
ENTRYPOINT ["/usr/bin/tini", "--"]
# CMD ["npx", "drizzle-kit", "push"]
# CMD ["npm", "run", "start-ts"]

CMD ["sh", "-c", "npx drizzle-kit push && npm run start-ts"]