#!/bin/sh
set -eu
# Apply database migrations before starting (PostgreSQL only).
case "${MOBSIM_DATABASE_URL:-}" in
  postgresql*) alembic upgrade head ;;
esac
exec "$@"
