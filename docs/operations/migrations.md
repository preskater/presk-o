# Migration deployment

Apply a schema change without losing data, and recover when a migration fails. The
project uses Prisma 7 migrations in `prisma/migrations/`; the application image does not
contain the Prisma CLI, so deployments use the one-shot `migrate` service or `npm run
db:deploy` on a workstation.

## Which command

| Situation | Command |
| --- | --- |
| You changed `prisma/schema.prisma` on a workstation | `npm run db:migrate -- --name <description>` |
| Apply already-committed migrations locally | `npm run db:deploy` |
| Apply already-committed migrations in containers | `docker compose --profile full run --rm migrate` |
| Full deployment (migrate, seed, app) | `docker compose --profile full up -d --build` |
| Read the migration state | `docker compose --profile full run --rm migrate npx prisma migrate status` |

`db:migrate` is `prisma migrate dev`: it writes a new migration, applies it and
regenerates the client. `db:deploy` is `prisma migrate deploy`: it only applies committed
migrations and never invents one. A deployment must use `db:deploy` or the `migrate`
service.

## Before deploying

1. Take a backup and verify it: see [Backup and restore](./backup-restore.md). A
   migration you cannot undo is only safe behind a restore you have tested.
2. Read the migration SQL in `prisma/migrations/<timestamp>_<name>/migration.sql`.
   Destructive statements (`DROP COLUMN`, `DROP TABLE`, narrowing a type) need an
   explicit data plan, not just a schema change.
3. Know the target: `POSTGRES_DB`, the compose project and the volume in use. The
   pinned volume names mean two compose project names can still share a volume.
4. Check the application version matches the migration set being deployed.

## Authoring a migration (workstation)

```sh
# 1. Edit prisma/schema.prisma, then:
npm run db:migrate -- --name add_something
npm run db:generate

# 2. Review the generated SQL.
$EDITOR prisma/migrations/*_add_something/migration.sql

# 3. Prove it still builds and the rules still hold.
npm run lint
npm run typecheck
npm run test
npm run build
```

Commit the schema change and the migration folder together. Never edit a migration that
has already been applied to a shared database: add a new one that corrects it.

## Deploying

### Full stack

```sh
docker compose --profile full up -d --build
```

Compose builds the image, applies migrations (`migrate`), creates or refreshes the owner
(`seed`), then starts `app`. `app` waits for both one-shot services, so a failed
migration never boots a server against an outdated schema.

### Migration only

```sh
# Rebuild the tooling image so it contains the new migration files.
docker compose --profile full build migrate
docker compose --profile full run --rm migrate

# Check what the database now reports.
docker compose --profile full logs --tail=50 migrate
docker compose --profile full run --rm migrate npx prisma migrate status
```

`docker compose run` reuses the existing image; rebuilding first matters when the
migration folders were added after the last build.

### Workstation against a deployment database

Only with an explicit `DATABASE_URL` for that database:

```sh
DATABASE_URL='postgresql://dashboard:dashboard@db.example.test:5432/dashboard?schema=public' \
  npm run db:deploy
```

Use this sparingly: it writes to a remote database from a workstation and requires the
database to be reachable. The container path keeps the credentials inside the deployment.

## Verify

- `migrate` exits `0`; `docker compose --profile full logs migrate` shows
  `All migrations have been successfully applied.`
- `npx prisma migrate status` (through the `migrate` service) reports no pending and no
  failed migration.
- The authenticated page **Diagnostic** (`/diagnostics`, linked from **Compte**) shows
  **Migrations** as OK, with the number applied and none pending. It reads the
  `_prisma_migrations` table and the migration folder copied into the image.
- Sign in, open the dashboard and one data page; a schema mismatch usually surfaces as a
  server error on the first query.

## When a migration fails

The database records the attempt in `_prisma_migrations`. Prisma refuses further
deploys while a failed row is unresolved.

1. **Read the log**, not the guess:
   ```sh
   docker compose --profile full logs --tail=100 migrate
   ```
   The message names the migration and the SQL error.
2. **Stop the application** so it does not serve against a half-migrated schema:
   ```sh
   docker compose --profile full stop app
   ```
3. **Decide: fix forward, or restore.**
   - *Fix forward*: correct the cause (a constraint violated by existing rows, a missing
     extension, a lock timeout), commit a new migration that repairs the state, rebuild
     the tooling image and deploy again.
   - *Restore*: when the migration partially changed data and no forward fix is safe,
     restore the verified backup taken before the deploy, then correct the migration and
     redeploy. See [Backup and restore](./backup-restore.md).
4. **If Prisma refuses to run because of the failed row** and you have established that
   the migration's SQL did not apply, mark it rolled back and retry:
   ```sh
   docker compose --profile full run --rm migrate \
     npx prisma migrate resolve --rolled-back <migration_name>
   docker compose --profile full run --rm migrate
   ```
   This only changes the bookkeeping: it does **not** undo SQL that already ran. When in
   doubt, restore instead.
5. Never delete or edit rows of `_prisma_migrations` by hand, and never edit an
   already-applied migration file.

There are no down migrations. Rolling back means restoring a backup or writing a new
migration that reverses the change.

## PostgreSQL major-version upgrades

Changing the `postgres` image to a new major version is a data migration, not a restart.
Follow the dump/restore sequence in
[decision 0002](../decisions/0002-postgresql-18-data-layout.md) and read the upgrade
section of [infra/backups/README.md](../../infra/backups/README.md). `verify.sh` and
`test-backup-cycle.sh` read the image from `compose.yaml`, so set `POSTGRES_IMAGE` when
verifying a dump produced by another major version.
