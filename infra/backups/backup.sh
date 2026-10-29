#!/bin/sh
# Logical backup of the dashboard database.
#
# Usage (from the repository root):
#   ./infra/backups/backup.sh [output-directory]
#
# The dump is written outside the database container, on the host, so that a
# container rebuild never destroys a backup. Backups are git-ignored: never
# commit a dump, it contains personal financial data.
#
# Next to each dump, two small files describe it (SO-04), without any data:
#   dashboard-<timestamp>.dump.sha256  checksum, checked first by verify.sh
#   dashboard-<timestamp>.json         timestamp, size, checksum, tool versions
# A backup is only "verified" once ./infra/backups/verify.sh has restored it.
#
# DB_CONTAINER=<name> dumps from that container instead of the compose `db`
# service; the backup cycle test uses it with a throwaway container.

set -eu

COMPOSE_PROJECT="${COMPOSE_PROJECT:-dashboard}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_NAME="${POSTGRES_DB:-dashboard}"
DB_USER="${POSTGRES_USER:-dashboard}"
OUTPUT_DIR="${1:-infra/backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="${OUTPUT_DIR}/dashboard-${TIMESTAMP}.dump"

db_exec() {
  if [ -n "${DB_CONTAINER:-}" ]; then
    docker exec -i "${DB_CONTAINER}" "$@"
  else
    docker compose exec -T "${DB_SERVICE}" "$@"
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

mkdir -p "${OUTPUT_DIR}"

echo "Dumping '${DB_NAME}' from ${DB_CONTAINER:-service ${DB_SERVICE}} to ${OUTPUT_FILE}"

# Written under a temporary name and renamed only once complete: a failed dump never
# leaves a truncated file that looks like a backup.
db_exec pg_dump --username="${DB_USER}" --dbname="${DB_NAME}" --format=custom --no-owner \
  > "${OUTPUT_FILE}.partial"
mv "${OUTPUT_FILE}.partial" "${OUTPUT_FILE}"

CHECKSUM="$(sha256 "${OUTPUT_FILE}")"
SIZE="$(wc -c < "${OUTPUT_FILE}" | tr -d ' ')"
PG_DUMP_VERSION="$(db_exec pg_dump --version | tr -d '\r"')"
SERVER_VERSION="$(db_exec psql --username="${DB_USER}" --dbname="${DB_NAME}" -tA -c 'SHOW server_version' | tr -d '\r"')"

# Same format as `sha256sum`, so `sha256sum -c` works on it too.
echo "${CHECKSUM}  $(basename "${OUTPUT_FILE}")" > "${OUTPUT_FILE}.sha256"

cat > "${OUTPUT_DIR}/dashboard-${TIMESTAMP}.json" <<EOF
{
  "file": "$(basename "${OUTPUT_FILE}")",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sizeBytes": ${SIZE},
  "sha256": "${CHECKSUM}",
  "pgDump": "${PG_DUMP_VERSION}",
  "serverVersion": "${SERVER_VERSION}",
  "format": "custom"
}
EOF

echo "Backup written: ${OUTPUT_FILE} (${SIZE} bytes, sha256 ${CHECKSUM})"
echo "It is not verified yet. Verify it with: ./infra/backups/verify.sh ${OUTPUT_FILE}"
