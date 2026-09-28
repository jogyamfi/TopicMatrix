# Self-hosted deployment guide

This covers running TopicMatrix outside Cloudflare — on your own server or machine, via Docker.
For the Cloudflare Workers target, see [adr-001-data-access.md](../planning/adr-001-data-access.md)
and the P11 section of [delivery-plan.md](../planning/delivery-plan.md).

## Docker Compose (recommended)

From a clean checkout:

```bash
git clone <repo-url>
cd TopicMatrix
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
```

This builds and starts three containers:

- `postgres` — PostgreSQL 15, with a named volume for persistent data.
- `api` — the Node API (`apps/api`), running database migrations (`prisma migrate deploy`,
  non-interactive) automatically on startup, then serving on port 3000 inside the compose network.
- `web` — the built React SPA, served by nginx on port 8080, reverse-proxying `/api/*` to the
  `api` container so the browser only ever talks to one origin (no CORS configuration needed).

Once healthy, open `http://localhost:8080`. Create the first admin account with:

```bash
docker compose exec api npm run seed:admin -w apps/api
```

**Always set a real `JWT_SECRET`** (32+ random characters, never a placeholder — the app fails
closed on startup otherwise, SEC-5). The example above generates one for the session; for a
persistent deployment, put it in a `.env` file next to `docker-compose.yml` instead
(`JWT_SECRET=...`), which Docker Compose reads automatically, or use `docker compose`'s secrets
support.

### HTTPS (required beyond localhost)

The session's refresh cookie is `Secure`, so browsers only send it over HTTPS, with one exception:
`http://localhost`. Opening the stack at `http://localhost:8080` on the machine running it works.
Opening it at `http://192.168.x.x:8080` from another device does not: you can sign in, but every
page reload signs you out again.

For anything past a local trial, put a TLS-terminating reverse proxy in front of the `web`
container. For example, with [Caddy](https://caddyserver.com/), which obtains and renews
certificates automatically, add this to `docker-compose.yml`:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
    command: caddy reverse-proxy --from topicmatrix.example.com --to web:80
    volumes:
      - caddy-data:/data
```

Add `caddy-data:` under `volumes:` as well. Remove the `web` service's `ports:` so the app is only
reachable through Caddy, and raise `TRUST_PROXY_HOPS` to `'2'` (Caddy, then nginx), as described
below.

For a quick trial over plain http on your LAN, you can set `COOKIE_SECURE: 'false'` on the `api`
service instead. The API refuses to start with that setting when `NODE_ENV=production`, which the
compose file sets, so you'd also have to change `NODE_ENV`. It is a trial-only escape hatch, never
for real use.

### Reverse proxies and the client IP

Login attempts are rate-limited per client IP (10 per 15 minutes). Inside the compose stack the
API only ever sees connections from the `web` nginx container, so `docker-compose.yml` sets
`TRUST_PROXY_HOPS: '1'` to read the real client address from the `X-Forwarded-For` header that
nginx appends. If you put another reverse proxy in front (for example Caddy or Traefik
terminating TLS), raise it by one for each extra proxy that appends to `X-Forwarded-For`. Never
set it higher than the real number of proxies: every extra hop lets a client choose the IP it is
rate-limited as.

### Updating

```bash
git pull
docker compose up --build -d
```

Migrations run automatically on the `api` container's next start; no manual step needed.

## Backup and restore

### PostgreSQL (the Docker Compose target)

Back up:

```bash
docker compose exec postgres pg_dump -U topicmatrix topicmatrix > backup.sql
```

Restore into a fresh database:

```bash
docker compose exec -T postgres psql -U topicmatrix topicmatrix < backup.sql
```

Take backups on a schedule appropriate for your data (e.g. a daily cron calling the command
above) and store them somewhere other than the same disk as the `topicmatrix-postgres-data`
volume.

### SQLite (the T1 local/no-Docker target)

The whole database is one file (`DATABASE_URL`, typically `./dev.db` at the repo root). Back up
by copying it while the app isn't mid-write (stop `npm run dev` first, or use SQLite's own
`.backup` command for a live, consistent copy):

```bash
sqlite3 dev.db ".backup 'backup.db'"
```

Restore by copying `backup.db` back over `dev.db` (app stopped) and restarting.

## Application-level export (every provider)

Independent of the database backup above, every user can export their own data from
**Settings → Export** in the app (`GET /export/json` for a complete, versioned JSON snapshot;
`GET /export/sessions.csv` for a filtered session history). This is a per-user, lossless export —
useful for migrating a single account's data or a personal backup, not a substitute for backing
up the whole database.
