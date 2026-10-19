# Contributing

Thank you for helping! Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Workflow

1. Open an issue for larger changes first.
2. Branch from `main`; never push to `main` directly. Open a pull request.
3. Keep PRs focused; update docs and `CHANGELOG.md` with behaviour changes.

## Checks (must pass)

```sh
cd frontend && npm ci && npm run format:check && npm run lint && npm run typecheck && npm test && npm run build && npm run check:secrets
cd frontend && npm run test:e2e
cd backend && pip install -e ".[dev]" && ruff format --check . && ruff check . && mypy app && pytest
docker compose config -q
```

## Project rules

- Pure logic goes in `frontend/src/{domain,geo,validation,analysis,simulation,schematic}` with unit tests.
- No unsourced numbers: defaults need a source or the label "placeholder" and a status.
- New data providers implement the interfaces in `frontend/src/providers/types.ts` /
  `backend/app/providers/` and return Provenance; credentials only on the backend.
- Accessibility: labelled controls, keyboard operation, no colour-only status,
  text alternatives for maps and charts.
- Dependencies: check licences (`npm run licenses`; `backend/scripts/license_report.py`)
  and update `THIRD_PARTY_NOTICES.md` and `docs/licenses/`.

## Licence of contributions

By submitting a contribution you agree to license it under the project's licence,
GNU AGPL-3.0-only (see `LICENSE`, `NOTICE` and `docs/LICENSING_OPTIONS.md`), and you
confirm you have the right to do so. New dependencies must have an AGPL-3.0-compatible
licence; list them in `THIRD_PARTY_NOTICES.md` with licence link and repository and
regenerate `docs/licenses/`.
