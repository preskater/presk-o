# Backups

Scripts and procedures only. **Never commit an actual backup**: a dump contains
personal financial data.

- `backup.sh` — logical `pg_dump` (custom format) written to this directory on the host.
- `restore.sh` — restores a dump into a target database, recreating it first.

## Procedure

```sh
./infra/backups/backup.sh
./infra/backups/restore.sh infra/backups/dashboard-<timestamp>.dump dashboard_restore_test
```

## PostgreSQL major-version upgrades

The compose image keeps data under `/var/lib/postgresql/<major>/docker`, with the
volume mounted once at `/var/lib/postgresql`. Changing the image to a new major
version is therefore a data migration, not a restart: dump the old cluster with
the previous major image, start the new image (it initialises a fresh cluster),
restore the dump and compare row counts. The 17 → 18 migration is described step
by step in `docs/decisions/0002-postgresql-18-data-layout.md`.

## To plan before production

- Encrypt backups at rest and store them outside the host (object storage, second disk).
- Schedule `backup.sh` (cron or systemd timer) and alert on failure.
- Run a restore test on a regular schedule, not only once: an untested backup is not a backup.
- Keep a retention policy (for example 7 daily, 4 weekly, 12 monthly) and document it.
- Backups live on the same disk as the database today: this is a development
  convenience, not a production strategy.
