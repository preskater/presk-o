#!/bin/sh
# End-to-end test of backup.sh and verify.sh on a throwaway stack (SO-04).
#
# Usage (from the repository root, after `npm ci`):
#   ./infra/backups/test-backup-cycle.sh
#
# 1. Starts a throwaway PostgreSQL (in-memory, bound to 127.0.0.1 on a random port),
#    applies the real migrations and seeds FICTITIOUS data. It never touches the
#    dashboard database or its volume.
# 2. backup.sh dumps it into a temporary directory; verify.sh must accept it.
# 3. Failure paths: a truncated copy must fail on its checksum, and a truncated copy
#    whose checksum was recomputed must fail on the restore itself.
# Everything is removed at the end. No dump ever leaves the temporary directory.
#
# Without Docker the test is skipped locally, but fails in CI (CI=true).

set -eu

# Same PostgreSQL image as compose.yaml, read from it so the two never drift apart.
IMAGE="${POSTGRES_IMAGE:-$(sed -n 's/^ *image: *\(postgres:[^ ]*\).*/\1/p' compose.yaml | head -1)}"
[ -n "${IMAGE}" ] || { echo "No postgres image found in compose.yaml: set POSTGRES_IMAGE." >&2; exit 1; }
SOURCE="presk-o-backup-test-source-$$"
WORK="$(mktemp -d)"

cleanup() {
  docker rm -f "${SOURCE}" > /dev/null 2>&1 || true
  rm -rf "${WORK}"
}
trap cleanup EXIT INT TERM

if ! docker info > /dev/null 2>&1; then
  if [ "${CI:-}" = "true" ]; then
    echo "FAIL: Docker is required for the backup cycle test in CI." >&2
    exit 1
  fi
  echo "SKIPPED: Docker is not available. See infra/backups/README.md for the manual procedure."
  exit 0
fi

step() { echo; echo "== $1"; }
expect_failure() {
  # $1 label, $2 dump, $3 expected reason fragment
  if ./infra/backups/verify.sh "$2" > "${WORK}/out.txt" 2>&1; then
    echo "FAIL: $1 was accepted" >&2
    exit 1
  fi
  grep -q '"status": "failed"' "${2%.dump}.verification.json" || { echo "FAIL: $1 not recorded as failed" >&2; exit 1; }
  grep -q "$3" "${2%.dump}.verification.json" || { echo "FAIL: $1 failed for an unexpected reason:" >&2; cat "${2%.dump}.verification.json" >&2; exit 1; }
  echo "ok: $1 rejected ($3)"
}

step "Throwaway source database with fictitious data"
docker run -d --rm --name "${SOURCE}" --tmpfs /var/lib/postgresql -p 127.0.0.1::5432 \
  -e POSTGRES_USER=dashboard -e POSTGRES_PASSWORD=dashboard -e POSTGRES_DB=dashboard \
  "${IMAGE}" > /dev/null
TRIES=0
until docker exec "${SOURCE}" pg_isready -h 127.0.0.1 -U dashboard -d dashboard > /dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  [ "${TRIES}" -lt 60 ] || { echo "FAIL: source database not ready" >&2; exit 1; }
  sleep 1
done
PORT="$(docker port "${SOURCE}" 5432/tcp | head -1 | sed 's/.*://')"

# Fictitious values only, scoped to this command: no real .env is read for them.
export DATABASE_URL="postgresql://dashboard:dashboard@127.0.0.1:${PORT}/dashboard?schema=public"
export AUTH_SECRET="backup-cycle-test-fictitious-secret-0123456789"
export INTEGRATION_ENCRYPTION_KEY="YmFja3VwLWN5Y2xlLXRlc3QtZmljdGl0aW91cy1rZXk="
export SEED_OWNER_EMAIL="owner@example.test"
export SEED_OWNER_PASSWORD="Fictitious-Password-2026"
npx prisma migrate deploy > /dev/null
npx prisma db seed > /dev/null

step "Backup and verification of a healthy dump"
DB_CONTAINER="${SOURCE}" ./infra/backups/backup.sh "${WORK}" > /dev/null
DUMP="$(ls "${WORK}"/dashboard-*.dump)"
[ -f "${DUMP}.sha256" ] || { echo "FAIL: no checksum written" >&2; exit 1; }
[ -f "${DUMP%.dump}.json" ] || { echo "FAIL: no metadata written" >&2; exit 1; }
./infra/backups/verify.sh "${DUMP}"
grep -q '"status": "verified"' "${DUMP%.dump}.verification.json" || { echo "FAIL: healthy dump not marked verified" >&2; exit 1; }

step "Failure path: truncated archive, original checksum"
SIZE="$(wc -c < "${DUMP}" | tr -d ' ')"
CORRUPT="${WORK}/dashboard-truncated.dump"
head -c $((SIZE / 2)) "${DUMP}" > "${CORRUPT}"
cp "${DUMP}.sha256" "${CORRUPT}.sha256"
expect_failure "a truncated archive" "${CORRUPT}" "checksum mismatch"

step "Failure path: truncated archive with a recomputed checksum"
RESTAMPED="${WORK}/dashboard-restamped.dump"
cp "${CORRUPT}" "${RESTAMPED}"
if command -v sha256sum > /dev/null 2>&1; then
  sha256sum "${RESTAMPED}" > "${RESTAMPED}.sha256"
else
  shasum -a 256 "${RESTAMPED}" > "${RESTAMPED}.sha256"
fi
expect_failure "a corrupt archive with a valid checksum" "${RESTAMPED}" "pg_restore failed"

echo
echo "Backup cycle test passed."
