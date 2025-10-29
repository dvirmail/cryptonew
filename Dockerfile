# Dockerfile for CryptoSentinel Proxy Server
FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY proxy-server.cjs ./
COPY start-proxy.sh ./
RUN chmod +x start-proxy.sh

# Create storage directory
RUN mkdir -p storage

# Expose port
EXPOSE 3003

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3003/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["node", "proxy-server.cjs"]

