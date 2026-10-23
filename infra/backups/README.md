# Backups

Scripts and procedures only. **Never commit an actual backup**: a dump contains
personal financial data. Dumps, checksums and metadata are git-ignored and excluded
from the Docker build context; CI never uploads one as an artifact.

- `backup.sh` — logical `pg_dump` (custom format) written to this directory on the host,
  with a checksum and a metadata file next to it.
- `verify.sh` — proves a dump is restorable by restoring it into a throwaway container.
- `restore.sh` — restores a dump into a target database, recreating it first.
- `test-backup-cycle.sh` — end-to-end test of the above on a throwaway stack (CI).

## Procedure

```sh
./infra/backups/backup.sh
./infra/backups/verify.sh infra/backups/dashboard-<timestamp>.dump
```

A backup is **verified only after `verify.sh` succeeded on it**. Until then it is a
hope, not a backup.

## What each backup leaves behind

| File | Written by | Content |
| --- | --- | --- |
| `dashboard-<timestamp>.dump` | `backup.sh` | the data (sensitive) |
| `dashboard-<timestamp>.dump.sha256` | `backup.sh` | checksum, `sha256sum -c` format |
| `dashboard-<timestamp>.json` | `backup.sh` | creation time, size, checksum, `pg_dump` and server versions |
| `dashboard-<timestamp>.verification.json` | `verify.sh` | `"status": "verified"` or `"failed"` with the reason, image used, counts of tables, migrations and rows |

None of the small files contains data: only counts, versions and checksums. A dump is
first written as `.partial` and renamed when complete, so a failed backup never looks
like a valid one.

## How verification works

`verify.sh` fails, writes `"status": "failed"` with the reason, and exits non-zero when:

1. the checksum does not match (corrupt or modified archive);
2. `pg_restore --exit-on-error` cannot load it into a **throwaway** PostgreSQL
   container — same image as `compose.yaml`, unique name, no published port, no
   volume (data in memory), removed at the end even on failure. It never connects to
   the real database;
3. the restored database has no table, no `_prisma_migrations` history, or a failed
   migration.

Reading a failure: the `reason` field says which step stopped. A checksum mismatch
means the file changed since `backup.sh` wrote it (copy, disk, transfer): take a new
backup. A restore failure with a valid checksum means the dump itself is unusable:
take a new backup and check the `pg_dump` and server versions in its `.json`.

## Restore test in CI

The `backup-restore` job of `.github/workflows/ci.yml` runs
`./infra/backups/test-backup-cycle.sh` on every pull request: it seeds a throwaway
database with fictitious data (real migrations, fictitious owner), backs it up,
verifies it, and checks that a truncated archive is rejected by its checksum and that
a corrupt archive with a recomputed checksum is rejected by the restore itself. A
failure there fails the pull request.

Locally, after `npm ci`, the same script runs in about 20 seconds. Without Docker it
prints `SKIPPED` (and fails in CI, where Docker is required).

### Manual procedure without Docker in CI

On a machine with Docker: run `./infra/backups/backup.sh`, then `verify.sh` on the new
dump, and keep the `.verification.json` next to it. Do this after every schema change
and on a regular schedule, not only once.

## PostgreSQL major-version upgrades

The compose image keeps data under `/var/lib/postgresql/<major>/docker`, with the
volume mounted once at `/var/lib/postgresql`. Changing the image to a new major
version is therefore a data migration, not a restart: dump the old cluster with
the previous major image, start the new image (it initialises a fresh cluster),
restore the dump and compare row counts. The 17 → 18 migration is described step
by step in `docs/decisions/0002-postgresql-18-data-layout.md`. `verify.sh` and
`test-backup-cycle.sh` read the PostgreSQL image from `compose.yaml`, so a restore is
always tested with the major version that produced the dump (`POSTGRES_IMAGE`
overrides it).

## To plan before production

- Encrypt backups at rest and store them outside the host (object storage, second disk).
- Schedule `backup.sh` followed by `verify.sh` (cron or systemd timer) and alert on failure.
- Run a restore test on a regular schedule, not only once: an untested backup is not a backup.
- Keep a retention policy (for example 7 daily, 4 weekly, 12 monthly) and document it.
- Backups live on the same disk as the database today: this is a development
  convenience, not a production strategy.
