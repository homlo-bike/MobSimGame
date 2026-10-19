# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability
reporting ("Security" tab → "Report a vulnerability") on
<https://github.com/homlo-bike/MobSimGame>. Include steps to reproduce, affected
versions and impact. We aim to acknowledge reports within 7 days.

## Supported versions

Only the latest release on `main` receives fixes during the 0.x series.

## Security design (summary)

- No secrets in the browser bundle (allow-listed `VITE_*` variables; CI bundle scan).
- Credentialed providers are proxied by the backend; secrets are `SecretStr`
  settings from environment variables and never returned by the API.
- Security headers and CSP (nginx for the app, middleware for the API), CORS
  allow-list, request-size limit, rate limiting, input and GeoJSON validation.
- Outbound requests: https only, host allow-list, private/loopback address
  rejection (SSRF protection), timeouts, backoff.
- Shared projects use unguessable ids; edit tokens are stored only as hashes;
  modifications are audit-logged with hashed client ids (no raw IPs).
- No tracking or analytics. Projects stay in the browser unless shared.
- Logging never records secrets, edit tokens, query strings or raw IPs; sensitive keys
  are redacted and debug logging is disabled in production (`docs/LOGGING.md`).
- Dependency audits in CI (`npm audit`, `pip-audit`).
