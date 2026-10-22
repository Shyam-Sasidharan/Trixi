# ==========================================
# STAGE 1: Build & Compile
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build essentials for native modules if needed
RUN apk add --no-cache python3 make g++

# Install dependencies based on package-lock
COPY package*.json ./
COPY tsconfig*.json nest-cli.json ./
RUN npm ci

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source code and build production bundle
COPY src ./src/
RUN npm run build

# Remove development dependencies to keep production footprint minimal
RUN npm prune --omit=dev

# ==========================================
# STAGE 2: Production Runner (<180MB)
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install curl for Docker healthchecks
RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV PORT=3000

# Copy runtime artifacts from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

# Use unprivileged user for security
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
