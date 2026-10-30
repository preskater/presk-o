# Operations runbooks

Procedures for deploying, restoring and recovering this dashboard, written so that a
maintainer who has never run the project can follow them with fictitious data. Project
commands use the repository's own scripts and services (`package.json`,
`compose.yaml`, `infra/backups/`); standard tools (`docker`, `curl`, `psql`, `openssl`)
are used to inspect and drive them. Nothing here is quoted from memory.

| I need to… | Runbook |
| --- | --- |
| Install the project on a workstation | [Local setup](./local-setup.md) |
| Ship a schema change | [Migration deployment](./migrations.md) |
| Take a backup, prove it restores, or recover lost data | [Backup and restore](./backup-restore.md) |
| Replace a provider token, or rotate a key or password | [Token and secret rotation](./token-rotation.md) |
| Understand a failed, partial or stale synchronisation | [Failed synchronisation recovery](./failed-synchronisation.md) |
| Check a deployment end to end | [Smoke verification](./smoke-verification.md) |
| Understand what the product itself reports | [Production diagnostics](./diagnostics.md) |

## Ground rules

- **Run commands from the repository root**, in `sh`/`bash`. Scripts resolve paths from
  there.
- **Fictitious values only** in examples, tickets, pull requests and chat. Never paste a
  real token, password, database URL, dump, transaction, address or amount. `.env` is
  local and git-ignored; `.env.example` is the only versioned configuration file.
- **Read-only first.** Diagnose with the diagnostics page, `docker compose ps`, logs and
  `SELECT` queries before changing anything. Destructive steps are marked **Mutating**.
- **A backup is a backup only once `verify.sh` has restored it.** Every procedure that
  touches data starts with a verified backup; see
  [Backup and restore](./backup-restore.md).
- **The backup scripts do not read `.env`.** `backup.sh` and `restore.sh` read
  `POSTGRES_USER` and `POSTGRES_DB` (and `backup.sh` also uses `DB_CONTAINER`);
  `verify.sh` reads `POSTGRES_IMAGE`. They default to the compose values (`dashboard`,
  `dashboard`, the image in `compose.yaml`). Export them explicitly when a deployment
  uses other values.
- **Use the npm scripts, not a bare `npx prisma`.** On a workstation without
  `node_modules`, `npx prisma` downloads the latest Prisma major (observed: an 8.0
  release candidate that renamed `migrate deploy` to `db migrate`). The project pins
  Prisma 7; `npm run db:*` and the `db-tools` image use that version.
- **Update the runbook in the same change as the behaviour.** If a script, compose
  service, environment variable or threshold changes, adjust the affected page and the
  command table in the README.

## How this repository runs

Two compose modes, both documented in `compose.yaml`:

| Mode | Command | What starts |
| --- | --- | --- |
| Database only | `docker compose up -d --wait db` | PostgreSQL, published on `127.0.0.1:${POSTGRES_PORT:-5432}` |
| Full stack | `docker compose --profile full up -d --build` | `db`, one-shot `migrate`, one-shot `seed`, then `app` (and `proxy` when the local override is present) |

- The application is published on `${APP_BIND_HOST:-0.0.0.0}:${APP_PORT:-3000}` unless a
  local `compose.override.yaml` is present. That override stops publishing the app and
  puts a Caddy proxy in front of it on `APP_HOST` (default
  `http://dashboard.localhost:8888`).
- `compose.override.yaml` and `infra/proxy/` are **not tracked** (`.gitignore` ignores
  `*override*.yaml` and `infra/proxy/`). A fresh clone therefore has no proxy: the
  application is reached directly on `APP_PORT`. Do not assume the proxy exists when
  following a procedure on someone else's machine or on a server.
- `migrate` and `seed` are one-shot services built from the `db-tools` stage of the
  `Dockerfile`. They apply migrations and create the single owner account before `app`
  starts; re-running them is safe.
- `app` never runs the Prisma CLI. To inspect migrations on a server, use the
  `migrate` service (`docker compose --profile full run --rm migrate …`).

## Known limits

These are deliberate gaps, repeated here so a runbook never pretends otherwise:

- **Nothing is scheduled.** Synchronisations, `backup.sh`, `verify.sh` and `db:cleanup`
  are manual or must be wired to an external scheduler (cron, systemd timer, platform
  job). The web process is replaceable by design.
- **Backups live on the same disk as the database**, in `infra/backups/`. Off-host,
  encrypted copies and a retention policy are an operator obligation, not a shipped
  feature.
- **There is no unauthenticated health endpoint.** `/diagnostics` requires the owner
  session; liveness can be probed through `/login` and `/manifest.webmanifest`.
- **`restore.sh` drops and recreates its target database.** It is not a merge or a
  point-in-time recovery tool.
- **Backup verification proves restorability, not freshness or off-host copies.**
- **Provider synchronisation is read-only.** No runbook ever needs provider write
  access.

## Keeping these pages honest

The procedures in this directory are exercised on a throwaway stack: an ephemeral
PostgreSQL container with fictitious data, a local build and the real scripts. See
[Smoke verification](./smoke-verification.md) for the recipe. When a procedure changes,
run that recipe before merging, and record which steps were exercised in the pull
request.
