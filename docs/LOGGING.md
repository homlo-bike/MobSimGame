# Logging

MobSimGame has one logger per side, configured once at start-up from an
environment variable.

| | Backend (FastAPI) | Frontend (browser) |
| --- | --- | --- |
| Module | `backend/app/logging_config.py` (stdlib `logging`) | `frontend/src/util/logger.ts` |
| Level variable | `MOBSIM_LOG_LEVEL` (fallback `LOG_LEVEL`) | `VITE_LOG_LEVEL` (build-time, public) |
| Format variable | `MOBSIM_LOG_FORMAT`: `json`, `text`, `auto` | automatic |
| Default level | `info` | `debug` in development, `info` in production builds |
| Production format | JSON, one object per line, on stderr | JSON string per entry in the console |
| Development format | `2026-10-19T17:14:12.287Z INFO    mobsim.request  request handled  key=value` | `17:18:28.049 INFO  [app] message {context}` |

## Levels

Most granular first; the configured level is the minimum that is emitted.

| Level | Aliases | Use for | Examples |
| --- | --- | --- | --- |
| `debug` | — | Developer detail: variable states, execution flow | cache hits, outbound response timings, edits committed, basemap switched |
| `info` | `log` | Operational milestones | API started/stopped, request handled, project shared, report generated, app started |
| `warning` | `warn` | Non-critical anomalies; execution continues | upstream retry/back-off, provider unavailable → fallback, rate limit, refused edit token, autosave failed |
| `error` | — | Failures of an operation that need attention | 5xx responses, unhandled exceptions, retries exhausted, upstream rejected credentials, map cannot start |

The frontend also accepts `silent` to disable console output.

## Production safety

- **Debug is never enabled in production.** Backend: with `MOBSIM_ENVIRONMENT=production`
  a configured `debug` becomes `info` and one warning is logged. Frontend: production
  builds clamp `debug` to `info`, and `logger.debug()` is a no-op function, so lazy
  context factories (`log.debug('msg', () => ({ … }))`) are never evaluated.
- **Redaction.** Values under keys matching token, secret, password, authorization,
  cookie, api key or credential are replaced with `[REDACTED]`, recursively, and
  `Bearer …` strings are masked in messages. Edit tokens and provider credentials are
  never passed to the logger in the first place.
- **No user content.** Request logs contain method, path, status, duration, request id
  and a hashed client id: never query strings (search text, coordinates), request
  bodies or raw IP addresses. Geocoder logs record only the query length.
- **Stack traces** are included by the backend for errors; the browser omits them in
  production builds.

## Request logging (backend)

`RequestLoggingMiddleware` logs every request once, when it completes, and returns an
`X-Request-ID` header (a well-formed incoming `X-Request-ID` from a proxy is reused).
Levels: 5xx and unhandled exceptions → `error`; 413/429 → `warning`; health checks →
`debug`; everything else → `info`. Uvicorn's own access log is disabled to avoid
duplicates; uvicorn start-up messages use the same formatter.

## Usage

Backend:

```python
from app.logging_config import get_logger

log = get_logger(__name__)  # → "mobsim.api.projects"
log.info("project shared", extra={"project_id": pid, "size_bytes": n})
log.warning("upstream rate limited; backing off", extra={"host": host, "delay_s": delay})
log.error("health check: database unavailable", exc_info=True)
```

Frontend:

```ts
import { createLogger, errorContext } from '../util/logger';

const log = createLogger('share');
log.info('project shared', { projectId });
log.warn('backend not reachable', { route });
log.error('could not open shared project', { projectId, ...errorContext(e) });
log.debug('style loaded', () => ({ layers: map.getStyle().layers.length })); // lazy
```

`console.*` is forbidden in `frontend/src` by ESLint (`no-console`) except inside the
logger. CLI scripts (`frontend/scripts`, `backend/scripts`) print to stdout/stderr
directly because their output is their interface.

## Configuration examples

```sh
# Backend, development: verbose, readable
MOBSIM_LOG_LEVEL=debug uvicorn app.main:app_factory --factory --reload

# Backend, production (Compose): JSON for a log collector
MOBSIM_ENVIRONMENT=production MOBSIM_LOG_LEVEL=warning MOBSIM_LOG_FORMAT=json

# Frontend build with only warnings and errors in the browser console
VITE_LOG_LEVEL=warn npm run build
```

`VITE_LOG_LEVEL` is compiled into the bundle; rebuild (or rebuild the `web` image with
`--build-arg VITE_LOG_LEVEL=…`) to change it.
