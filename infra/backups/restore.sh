#!/bin/sh
# Restore a backup produced by backup.sh into a target database.
#
# Usage (from the repository root):
#   ./infra/backups/restore.sh <dump-file> <target-database>
#
# Restoring into an existing database overwrites its content: the target is
# dropped and recreated first. Never point this at production by accident.
#
# DB_CONTAINER=<name> restores into that container instead of the compose `db`
# service, which is how a restore is rehearsed on a throwaway database; the
# backup cycle test and the runbook in docs/operations/backup-restore.md use it.

set -eu

DUMP_FILE="${1:?usage: restore.sh <dump-file> <target-database>}"
TARGET_DB="${2:?usage: restore.sh <dump-file> <target-database>}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${POSTGRES_USER:-dashboard}"

if [ ! -f "${DUMP_FILE}" ]; then
  echo "Dump file not found: ${DUMP_FILE}" >&2
  exit 1
fi

db_exec() {
  if [ -n "${DB_CONTAINER:-}" ]; then
    docker exec -i "${DB_CONTAINER}" "$@"
  else
    docker compose exec -T "${DB_SERVICE}" "$@"
  fi
}

echo "Recreating database '${TARGET_DB}' in ${DB_CONTAINER:-service ${DB_SERVICE}}"
db_exec psql --username="${DB_USER}" --dbname=postgres \
  -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\";" \
  -c "CREATE DATABASE \"${TARGET_DB}\";"

echo "Restoring ${DUMP_FILE} into ${TARGET_DB}"
db_exec pg_restore --username="${DB_USER}" --dbname="${TARGET_DB}" --no-owner --clean --if-exists \
  < "${DUMP_FILE}"

echo "Restore finished. A restore test must be run before going to production."
