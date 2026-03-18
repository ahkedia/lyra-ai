FROM node:18-alpine

WORKDIR /home/openclaw

# Install system dependencies
RUN apk add --no-cache \
    curl \
    git \
    bash \
    openssl

# Install OpenClaw CLI
RUN npm install -g @openclaw/cli

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY config ./config
COPY skills ./skills
COPY notion ./notion
COPY docs ./docs

# Create workspace directory and set permissions
RUN mkdir -p /home/openclaw/workspace

# SECURITY: Create non-root user and set ownership
RUN addgroup -S lyra && adduser -S lyra -G lyra && \
    chown -R lyra:lyra /home/openclaw

# Switch to non-root user
USER lyra

# Expose ports
EXPOSE 18789

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:18789/api/v1/health || exit 1

# Start OpenClaw
CMD ["openclaw", "start", "--config", "/home/openclaw/config/openclaw.json"]
