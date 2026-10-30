# Production diagnostics

Read what the application itself reports about its health, then go to the runbook that
fixes it. The page is `/diagnostics`, linked from **Compte** as **Diagnostic du système**.

## Access and safety

- It requires the owner session (`requireUser()`), is rendered server-side and is never
  cached: the answer is about the system at that moment.
- There is no unauthenticated health endpoint. For liveness, probe the public
  `/login` page (and `/manifest.webmanifest`) with `curl`.
- No check returns a secret, a connection string, a token or a raw error message. It
  reports presence, validity, counts, names and dates. Screenshots still show provider
  instance hosts and connection state, so treat them as private.

## What each check means

| Check (French label) | Source | Status and threshold | Runbook when not OK |
| --- | --- | --- | --- |
| **Base de données** | `SELECT 1` bounded by 3 s | Error when the database does not answer | [Local setup](./local-setup.md) (local), host/container checks below |
| **Migrations** | Failed and unfinished rows in `_prisma_migrations`, compared with the migration folders copied into the image | Error on a failed or pending migration; warning when the folder is not visible | [Migration deployment](./migrations.md) |
| **Clé de chiffrement des jetons** | Presence and base64/32-byte validity of `INTEGRATION_ENCRYPTION_KEY` | Error when missing or invalid | [Token and secret rotation](./token-rotation.md) |
| **Secret de session** | Presence and minimum length of `AUTH_SECRET` | Error when missing or shorter than 32 characters | [Token and secret rotation](./token-rotation.md) |
| **Connexions GitHub / GitLab** | Connection status, last success, stored safe error | Warning for not connected, never synced or older than 7 days; error for a failed last attempt | [Failed synchronisation recovery](./failed-synchronisation.md) |
| **Dernière sauvegarde** | Newest `dashboard-<timestamp>.dump` **file name** under `BACKUP_DIR`; the dump is never opened | Error when none exists; warning when older than 7 days or when the folder is not visible | [Backup and restore](./backup-restore.md) |
| **Version** | `package.json` version, plus `APP_VERSION` when set | Informational | — |

The page shows the worst status of all checks in a banner: at least one error, or at
least one warning. A warning is not a failure; it says what to look at. The thresholds
live in `src/modules/diagnostics/checks.ts` (backup and sync age) and
`src/modules/integrations/domain.ts` (dashboard staleness). The page is read-only: it
never repairs anything.

Two honest limits worth remembering:

- **Backup age is not restorability.** A file named today may not restore. Only
  `./infra/backups/verify.sh` proves that.
- **Connection status is the last stored result.** It does not probe the provider on
  page load. A token revoked a minute ago still reads `CONNECTED` until the next run.

## Triage

| What the page says | First thing to check | Then |
| --- | --- | --- |
| Database does not answer | `docker compose --profile full ps`, then `docker compose --profile full logs --tail=100 db` | `DATABASE_URL`, the `db` healthcheck, disk space. |
| A migration failed or is pending | `docker compose --profile full logs --tail=100 migrate` | [Migration deployment](./migrations.md). Do not start `app` against an outdated schema. |
| Encryption key missing or invalid | Presence of `INTEGRATION_ENCRYPTION_KEY` in the service environment | [Token and secret rotation](./token-rotation.md); stored tokens must be re-entered after a key change. |
| Session secret missing or too short | `AUTH_SECRET` in the service environment | Rotate it; every session will be signed out. |
| Connection in error, stale or never synced | `/integrations` run history and safe error code | [Failed synchronisation recovery](./failed-synchronisation.md). |
| No backup, or older than 7 days | `ls -1t infra/backups/dashboard-*.dump \| head -1` on the host | Take and verify one: [Backup and restore](./backup-restore.md). |
| Backup folder not visible | `BACKUP_DIR` and the read-only mount of `./infra/backups` in `compose.yaml` | Fix the mount; do not copy dumps into the image. |
| Version shows no build identifier | `APP_VERSION` was not set at deploy time | Optional; set it to the commit hash for support. |

## Commands behind the page

**Read-only.**

```sh
# Containers that should be up (proxy only with the local override present).
docker compose --profile full ps

# Application errors. The application never logs provider tokens, but logs can quote
# personal data: never paste a full log into a public issue.
docker compose --profile full logs --tail=100 app

# One-shot services: did the migration and the seed finish?
docker compose --profile full logs --tail=50 migrate seed

# Database reachable from inside the db container (local socket, no password).
docker compose exec -T db psql -U dashboard -d dashboard -c 'SELECT 1;'

# Migration state, using the image that owns the Prisma CLI.
docker compose --profile full run --rm migrate npx prisma migrate status

# Newest dumps and their verification results (on the host).
ls -1t infra/backups/dashboard-*.dump | head -1
cat infra/backups/dashboard-<timestamp>.verification.json

# Disk and volume usage, for the "database slow / write failed" case.
df -h .
docker system df -v

# Liveness and the origin the browser must use.
ORIGIN='https://dashboard.example.test'
curl -s -o /dev/null -w '%{http_code}\n' "$ORIGIN/login"
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "$ORIGIN/dashboard"
```

Replace `dashboard` in the `psql` command when `POSTGRES_USER` / `POSTGRES_DB` differ:
the scripts do not read `.env`, and neither does this command.

## What the page cannot see

- Whether a dump restores, or whether an off-host copy exists.
- Whether the provider token still works between two runs.
- Host health: memory, disk, CPU, TLS certificate expiry, proxy configuration.
- Whether a scheduler exists at all (none ships with the repository).
- Request-level latency or errors; use the proxy and application logs for those.

## Routine

| Moment | Check |
| --- | --- |
| After every deploy | `/diagnostics` after signing in; database, migrations, keys and version must be OK |
| After a migration | Migrations OK, no pending, one data page opens |
| Weekly, or on a schedule | Newest backup verified; restore rehearsal on a throwaway container |
| When a token is rotated | Connection synchronises; the page returns to OK |
| Before an incident report | Capture the page, the run history and the relevant logs; never a dump or a token |
