# Single stage — no build step (plain Node.js + CommonJS, no transpilation)
FROM node:24-alpine

WORKDIR /app

# Install prod deps only (COPY first to leverage Docker layer cache)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source (exclude tests, docs, etc.)
COPY src/ ./src/

ENV NODE_ENV=production PORT=8080

EXPOSE 8080

CMD ["node", "src/server.js"]
