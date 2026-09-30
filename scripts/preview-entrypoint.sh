#!/bin/sh
# Story-preview entrypoint: apply migrations (advisory-locked, idempotent), then start the API.
set -e
node scripts/migrate.mjs
exec node apps/api/dist/server.js
