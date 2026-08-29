# ==============================================================================
# Nate's Software Suite — Ephemeral Linux Terminal Gateway
# ==============================================================================
# SECURITY BOUNDARY & ARCHITECTURAL TRUTH:
# - This image is the stateless gateway, not the user execution boundary.
# - Production sessions run in separate provider-managed ephemeral VMs.
# - The gateway contains no Docker socket and never spawns user shells locally.
# - Credentials: ZERO LLM API keys or platform secrets baked into this image.
#   All tokens & environment variables are stripped and scrubbed at runtime.
# ==============================================================================

FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package descriptors
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy source code and build TypeScript
COPY src/ ./src/
RUN npm run build

# ------------------------------------------------------------------------------
# Production Runtime Stage
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Minimal gateway diagnostics only. User toolchains live in the verified Daytona
# VM snapshot, never in this shared orchestrator container.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    ca-certificates \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Create non-root terminal user
RUN useradd -m -u 1000 -s /bin/bash terminal && \
    mkdir -p /app /tmp && \
    chown -R terminal:terminal /app /tmp && \
    chmod 1777 /tmp

# Copy compiled artifacts & production dependencies
COPY --chown=terminal:terminal package*.json ./
RUN npm ci --omit=dev

COPY --chown=terminal:terminal --from=builder /app/dist ./dist

# Switch to unprivileged terminal user
USER terminal

# Expose Terminal Gateway WebSocket & HTTP port
EXPOSE 4000

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:4000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
