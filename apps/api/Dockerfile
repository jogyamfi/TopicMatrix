# Self-hosted deployment target (T2/NF-11) — build context is the REPO ROOT (npm workspaces
# need every package.json present to resolve the dependency graph), not apps/api. Runs the same
# `tsx src/index.ts` entrypoint as local dev (apps/api/package.json's own "start" script) rather
# than a separate compiled-JS path, since that's the only entrypoint this repo's own scripts
# already exercise. Verified end to end in R5: a fresh `docker compose up --build` passes the full
# E2E suite (`npm run test:e2e:docker`).
FROM node:20-alpine AS base
WORKDIR /app
# Prisma's query engine needs OpenSSL; libc6-compat helps some native addons run on musl.
RUN apk add --no-cache openssl libc6-compat

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/api-core/package.json ./packages/api-core/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci

FROM deps AS runtime
COPY . .
ENV NODE_ENV=production
ENV DATABASE_PROVIDER=postgresql
# All three Prisma clients, not just PostgreSQL's: packages/db's Node entry imports the SQLite and
# PostgreSQL clients statically (the provider is picked at runtime), so a missing SQLite client
# crashes the API at startup (found when this stack was first run for real, R5). `prisma generate`
# needs no database connection; the real DATABASE_URL is supplied at run time (compose).
RUN npm run db:generate
EXPOSE 3000
# `migrate deploy` (non-interactive, production-safe) runs against the REAL DATABASE_URL at
# container start, then the server starts — never `migrate dev`, which prompts interactively.
CMD ["sh", "-c", "npx prisma migrate deploy --schema=prisma/postgres/schema.prisma && npm run start -w apps/api"]
