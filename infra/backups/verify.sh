#!/bin/sh
# Verify a backup produced by backup.sh by actually restoring it (SO-04).
#
# Usage (from the repository root):
#   ./infra/backups/verify.sh infra/backups/dashboard-<timestamp>.dump
#
# A backup is "verified" only when all of this succeeds:
#   1. its checksum matches dashboard-<timestamp>.dump.sha256 (catches a corrupt copy);
#   2. pg_restore loads it, with no error, into a THROWAWAY PostgreSQL container:
#      unique name, no published port, no volume (data in memory), removed at the end
#      even on failure. It never talks to the real database;
#   3. the restored database has tables, a _prisma_migrations history and no failed
#      migration.
#
# The outcome is written to dashboard-<timestamp>.verification.json, "verified" or
# "failed" with the reason, and the exit status is non-zero on failure. Only counts
# are recorded, never data.
#
# Run from the repository root. POSTGRES_IMAGE overrides the image of compose.yaml.

set -eu

DUMP_FILE="${1:?usage: verify.sh <dump-file>}"
# Same PostgreSQL image as compose.yaml, read from it so the two never drift apart.
IMAGE="${POSTGRES_IMAGE:-$(sed -n 's/^ *image: *\(postgres:[^ ]*\).*/\1/p' compose.yaml | head -1)}"
[ -n "${IMAGE}" ] || { echo "No postgres image found in compose.yaml: set POSTGRES_IMAGE." >&2; exit 1; }
RESULT_FILE="${DUMP_FILE%.dump}.verification.json"
CONTAINER="presk-o-restore-check-$$-$(date +%s)"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

write_result() {
  cat > "${RESULT_FILE}" <<EOF
{
  "file": "$(basename "${DUMP_FILE}")",
  "status": "$1",
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "reason": "$2",
  "sha256": "${ACTUAL_SUM:-}",
  "image": "${IMAGE}",
  "tables": ${TABLES:-0},
  "migrations": ${MIGRATIONS:-0},
  "rows": ${ROWS:-0}
}
EOF
}

# Reasons are fixed sentences: nothing read from the dump ends up in the result file.
fail() {
  write_result "failed" "$1"
  echo "Verification FAILED: $1" >&2
  exit 1
}

if [ ! -f "${DUMP_FILE}" ]; then
  echo "Dump file not found: ${DUMP_FILE}" >&2
  exit 1
fi

# 1. Integrity.
[ -f "${DUMP_FILE}.sha256" ] || fail "no checksum file next to the dump"
EXPECTED_SUM="$(cut -d' ' -f1 < "${DUMP_FILE}.sha256")"
ACTUAL_SUM="$(sha256 "${DUMP_FILE}")"
[ "${EXPECTED_SUM}" = "${ACTUAL_SUM}" ] || fail "checksum mismatch: the archive is corrupt or was modified"

# 2. Restore into a throwaway container.
command -v docker >/dev/null 2>&1 || fail "docker is not available: run the manual procedure (README)"
trap 'docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true' EXIT INT TERM

echo "Starting throwaway PostgreSQL ${IMAGE} (${CONTAINER})"
docker run -d --rm --name "${CONTAINER}" --tmpfs /var/lib/postgresql \
  -e POSTGRES_USER=verify -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify \
  "${IMAGE}" > /dev/null || fail "could not start the throwaway PostgreSQL container"

# Over TCP: the entrypoint's temporary init server only listens on the socket, so this
# waits for the real server instead of a half-initialised one.
TRIES=0
until docker exec "${CONTAINER}" pg_isready -h 127.0.0.1 -U verify -d verify > /dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  [ "${TRIES}" -lt 60 ] || fail "the throwaway PostgreSQL did not become ready"
  sleep 1
done

psql_value() {
  docker exec "${CONTAINER}" psql -U verify -d verify -tA -c "$1" | tr -d '\r'
}

echo "Restoring $(basename "${DUMP_FILE}")"
docker exec -i "${CONTAINER}" \
  pg_restore -U verify -d verify --no-owner --no-acl --exit-on-error \
  < "${DUMP_FILE}" > /dev/null 2>&1 || fail "pg_restore failed: the archive cannot be restored"

# 3. Sanity of what was restored.
TABLES="$(psql_value "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")"
[ "${TABLES}" -gt 0 ] || fail "no table was restored"

HAS_HISTORY="$(psql_value "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations'")"
[ "${HAS_HISTORY}" = "1" ] || fail "no _prisma_migrations table: this is not a dashboard backup"

MIGRATIONS="$(psql_value "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")"
FAILED="$(psql_value "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL")"
[ "${MIGRATIONS}" -gt 0 ] || fail "the migration history is empty"
[ "${FAILED}" = "0" ] || fail "the backup contains a failed migration"

# Exact row count over every table (counts only, no content).
ROWS="$(psql_value "SELECT coalesce(sum((xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint), 0) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")"

write_result "verified" ""
echo "Backup VERIFIED: ${TABLES} tables, ${MIGRATIONS} migrations, ${ROWS} rows restored."
echo "Result: ${RESULT_FILE}"
