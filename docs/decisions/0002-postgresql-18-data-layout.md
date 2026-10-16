# 0002 — PostgreSQL 18 data-directory layout and the 17 → 18 migration

- Status: accepted
- Date: 2026-10-15

## Context

The compose image was bumped from `postgres:17-alpine` to `postgres:18.6-alpine3.24`.
PostgreSQL 18+ images changed their convention: `PGDATA` is now
`/var/lib/postgresql/<major>/docker`, and the volume must be mounted once at
`/var/lib/postgresql` so that all major-version directories live side by side —
which is what allows `pg_upgrade --link` later. Keeping the pre-18 mount
`db-data:/var/lib/postgresql/data` makes the 18+ entrypoint refuse to start and
point at docker-library/postgres#1259.

The existing `dashboard_db-data` volume contained a PostgreSQL 17 cluster, in the
old layout, with data entered through the application (budget, work days, issue
snapshots): it could not be discarded.

## Decision

- Mount the volume at `/var/lib/postgresql`; 18 stores its cluster in
  `/var/lib/postgresql/18/docker`.
- Migrate with a logical dump/restore, following the conventions of
  `infra/backups/` (custom-format dump, `--no-owner`, restore through
  `infra/backups/restore.sh`):
  1. dump the 17 cluster with `pg_dump` from a temporary `postgres:17-alpine`
     container attached to the same volume;
  2. move the old cluster files to `/var/lib/postgresql/pg17-retired` inside the
     volume (a rename, not a copy) and keep them as a cold fallback until the 18
     cluster is trusted;
  3. start 18 — it runs a fresh `initdb` in `18/docker` — and restore the dump;
  4. compare exact per-table row counts between the 17 snapshot and the restored
     database before considering the migration done.

## Alternatives considered

- *Pin `PGDATA=/var/lib/postgresql/data` to keep the old mount*: works, but opts
  out of the new convention, keeps the image warning, and blocks `pg_upgrade
  --link` for the next major upgrade.
- *`pg_upgrade` via `pgautoupgrade` or `tianon/postgres-upgrade`*: needs both
  majors' binaries in one container; justified for large clusters, not for a
  single-user database of a few dozen MB whose logical dump is already exercised
  by the backup scripts.
- *Recreate the database from migrations and the seed*: loses data entered
  through the application, which the product is explicitly supposed to protect.

## Consequences

- Future major upgrades fit the new layout: one mount at `/var/lib/postgresql`,
  and either `pg_upgrade --link` or the dump/restore recipe above.
- The pre-migration dump stays (git-ignored) in `infra/backups/` as the recovery
  path; the raw 17 files remain parked inside the volume until deleted by hand.
- CI uses `postgres:18-alpine`, the same major version as compose.
