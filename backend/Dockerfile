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
COPY package.json package-lock.json tsconfig.json ./
COPY prisma ./prisma
# prisma/seed.ts runs via ts-node at container startup and imports from
# src/modules/settings/company.default — the TS source, not the compiled
# dist output — so both the source file and tsconfig.json (which ts-node
# needs to pick up the project's module settings, not its own defaults)
# must be present here too, not just in the build stage.
COPY --from=build /app/src ./src
# Create logs and uploads directories with proper permissions
RUN mkdir -p /app/logs /app/uploads && chmod 777 /app/logs /app/uploads
# Run as the unprivileged built-in `node` user, not root. The copied files
# are owned by root and stay read-only to the app, which is what we want.
USER node
EXPOSE 4000
# Apply migrations, seed data, then start the API
CMD ["sh", "-c", "npx prisma migrate deploy && npm run prisma:seed && node dist/main.js"]
