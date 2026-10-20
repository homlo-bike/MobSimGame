# Self-hosting

## Requirements

Docker Engine with Compose v2, ~2 GB RAM, outbound https to the tile, glyph,
terrain, Overpass and Nominatim hosts you use.

## Start

The services join an existing Docker network named `public` (declared `external` in
`docker-compose.yml`, e.g. shared with a reverse proxy). Create it once per host:

```sh
docker network create public
```

Environment files for each stage are in `env/`:

| File | Use |
| --- | --- |
| `env/development.env` | Local development (`MOBSIM_ENVIRONMENT=development`, debug logs, street routing on). Local, non-secret values only. |
| `env/test.env` | Test and end-to-end runs (`MOBSIM_ENVIRONMENT=test`). Local, non-secret values only. |
| `env/production.env.example` | Template for a server: copy to `.env` and replace every `change-me` value with a long random secret. |

All three set `MOBSIM_VALHALLA_URL=http://valhalla:8002` (the routing service of the
`routing` Compose profile). Use one with `--env-file`, for example
`docker compose --env-file env/development.env --profile routing up -d --build`.
Never put real secrets in `env/`; it is committed.

```sh
cp env/production.env.example .env   # set POSTGRES_PASSWORD, MOBSIM_ADMIN_PASSWORD, MOBSIM_SESSION_SECRET
docker compose up -d --build  # http://localhost:8080
docker compose ps             # db, api, web should be "healthy"
curl http://localhost:8080/api/health
```

Services:

| Service | Image | Purpose |
| --- | --- | --- |
| `db` | `postgis/postgis:16-3.4` | Shared projects; volume `db-data` |
| `api` | `./backend` | FastAPI; runs `alembic upgrade head` on start |
| `web` | `./frontend` | nginx: static app + `/api` reverse proxy, CSP and security headers |
| `frontend-dev` | `node:22-alpine` | Profile `dev`: Vite with hot reload on :5173 |
| `valhalla` | `ghcr.io/valhalla/valhalla-scripted` | Profile `routing`: street routing for bus/BRT ([ROUTING.md](ROUTING.md)) |

## Login for saving and sharing

Saving and sharing projects on the server needs a login; the editor itself and
shared links do not. Set `MOBSIM_ADMIN_USERNAME` and `MOBSIM_ADMIN_PASSWORD` in `.env`
(default `admin` / `admin`). With `MOBSIM_ENVIRONMENT=production` (the Compose
default) the API **refuses to start while the password is `admin`**; on a test machine
you can set `MOBSIM_ENVIRONMENT=development` instead. Set `MOBSIM_SESSION_SECRET` to
a long random value so logins survive API restarts. Sessions last
`MOBSIM_SESSION_TTL_S` (8 h); login attempts are limited to
`MOBSIM_LOGIN_ATTEMPTS_PER_MINUTE` (10) per client.

Development profile: `docker compose --profile dev up --build`.

## Reverse proxy and TLS

Terminate TLS in front of `web` (Caddy, Traefik, nginx). Forward
`X-Forwarded-For` / `X-Forwarded-Proto`. Set `MOBSIM_PUBLIC_BASE_URL` and
`MOBSIM_CORS_ORIGINS` to the public origin. Add `Strict-Transport-Security` at the
TLS proxy. If you add basemap hosts, extend the CSP in `frontend/nginx.conf`.

## Configuration

See `.env.example` and `docs/PROVIDER_CONFIGURATION.md`. Secrets are read from the
environment only; never bake them into images or `VITE_*` variables.

## Logs

```sh
docker compose logs -f api     # JSON lines (MOBSIM_LOG_FORMAT=auto in production)
docker compose logs -f web     # nginx access/error log
```

Set `MOBSIM_LOG_LEVEL` (`debug`, `info`, `warning`, `error`) in `.env`; debug is
ignored when `MOBSIM_ENVIRONMENT=production`. Each API response carries an
`X-Request-ID` that also appears in its log line. See `docs/LOGGING.md`.

## Database initialisation and migrations

Migrations run automatically when `api` starts. Manually:

```sh
docker compose exec api alembic upgrade head
docker compose exec api alembic current
```

## Backup and restore

```sh
# Backup
docker compose exec -T db pg_dump -U mobsim -Fc mobsim > mobsim-$(date +%F).dump
# Restore (into an empty database)
docker compose exec -T db pg_restore -U mobsim -d mobsim --clean --if-exists < mobsim-2026-10-19.dump
```

Users' unshared projects live only in their browsers; ask them to use
**File › Save project** for file backups.

## Scaling notes

Rate limiting and provider caches are in-process. Run one API worker, or put a
shared limiter (reverse proxy, Redis — Phase 3) in front before scaling out.
Nominatim's 1 request/second limit applies to the whole deployment.

## Upgrades

`git pull && docker compose up -d --build` (the web app on port 8080 is built into the image, so a pull alone changes nothing that runs). Ports, build check and troubleshooting: README, "Ports" and "Updating". Read `CHANGELOG.md` for migration notes.
