# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npx nest build

# ---- runtime ----
FROM node:22-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Create logs and uploads directories with proper permissions
RUN mkdir -p /app/logs /app/uploads && chmod 777 /app/logs /app/uploads
# Run as the unprivileged built-in `node` user, not root. The copied files
# are owned by root and stay read-only to the app, which is what we want.
USER node
EXPOSE 4000
# Apply migrations, seed data, then start the API
CMD ["sh", "-c", "npx prisma migrate deploy && npm run prisma:seed && node dist/main.js"]
