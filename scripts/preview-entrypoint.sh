#!/bin/sh
# Story-preview entrypoint: builds DATABASE_URL from Cloud SQL parts, migrates, starts the API.
set -e
if [ -z "$DATABASE_URL" ] && [ -n "$DB_NAME" ]; then
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${INSTANCE_CONNECTION_NAME}"
fi
node scripts/migrate.mjs
exec node apps/api/dist/server.js
