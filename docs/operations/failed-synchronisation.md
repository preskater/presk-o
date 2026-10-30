# Failed synchronisation recovery

Read a failed, partial or stale provider synchronisation, decide whether it is
transient, and recover without duplicating or deleting data. Synchronisations are
read-only towards the provider and idempotent towards the database: replaying one
updates snapshots instead of duplicating them.

## What the interface shows

| State | Where | Meaning |
| --- | --- | --- |
| `SUCCESS` | Integrations, run history | Every selected repository was read and stored. |
| `PARTIAL` | Integrations, run history | The run completed but some repositories were not read; their data is unknown, never zero. The run still counts as fresh, and the row counts the repositories left unread. |
| `FAILED` | Integrations, run history | The run stopped; a safe error code is shown. The previous successful data is kept. |
| `RUNNING` | Integrations, run history | The run has not finished. If it stays there, the process was interrupted; see below. |
| `ERROR` | Connections table | The connection's last attempt failed. |
| `CONNECTED` + old date | Connections table | Data exists but is stale. |
| `NOT_CONNECTED` / never synced | Connections table, Diagnostic | No successful read yet: not the same thing as "no projects". |

Freshness thresholds:

- the dashboard shows a banner when a connection's last **successful** synchronisation
  is older than **24 hours**;
- **Diagnostic** reports a warning when it is older than **7 days**.

Every attempt writes a `SyncRun` row: status, counters (fetched, created, updated,
skipped, failed), bounded retries and a safe error summary. No token and no provider
response body is stored.

## Error codes

The connection's `lastSyncError` and the run's `errorSummary` use
`<CODE> (HTTP <status>)`, for example `RATE_LIMITED (HTTP 403)`.

| Code | Typical cause | Action |
| --- | --- | --- |
| `UNAUTHORIZED` | Expired or revoked token, missing `read_api` / repository permissions, GitLab token without the right scope. GitHub also answers 403 here when the quota header is absent. | Replace the token: [Token and secret rotation](./token-rotation.md). |
| `NOT_FOUND` | Wrong instance URL, wrong organisation/group, repository no longer visible to the token. | Correct the organisation/group or the instance URL. Changing the instance URL creates a new connection (see the rotation runbook). |
| `RATE_LIMITED` | GitHub quota spent (403 with `x-ratelimit-remaining: 0`) or HTTP 429. | Wait for the reset window, then retry. Transient failures are already retried a bounded number of times within the run; a long `Retry-After` is not waited for. |
| `NETWORK` | DNS, TLS, proxy or timeout between the app and the provider. | Check reachability from the application container, then retry. |
| `HTTP_ERROR` | Provider 5xx after retries, or another non-success status. | Retry later; check the provider's status page. |
| `INVALID_RESPONSE` | The provider returned a shape the adapter does not understand (often a self-hosted version difference). | Verify the instance version; retry once; keep the safe code for a bug report. |
| `UNEXPECTED_ERROR` | An application error outside the provider mapping. | Check the app logs; report with the error type, never with a token or payload. |

Skipped runs carry no HTTP status:

| Reason | Meaning | Action |
| --- | --- | --- |
| `NO_TOKEN` | The connection has no readable token: absent, or unreadable because `INTEGRATION_ENCRYPTION_KEY` changed. | Re-enter the token; see [Token and secret rotation](./token-rotation.md). |
| `NOT_FOUND` | The connection no longer exists for this workspace (stale page or deleted row). | Reload `/integrations` and retry. |

## Triage

**Read-only.**

1. **Open `/diagnostics`.** The **Connexions GitHub / GitLab** line names the provider
   and instance host with the last safe error, or says the connection was never
   synchronised. Nothing there is a secret.
2. **Open `/integrations`.** The **Connexions** table shows status and last success; the
   **Historique des synchronisations** table (last 50) shows the status, counters and
   retries of each attempt. A `PARTIAL` run counts the repositories it could not read.
3. **Retry once** with the synchronisation button. The run is idempotent; a transient
   failure usually clears on the second attempt.
4. **Act on the code** using the tables above. `UNAUTHORIZED` and `NO_TOKEN` need a new
   token; `RATE_LIMITED` needs time; `PARTIAL` usually clears on a retry.
5. **Stuck `RUNNING`:** the web process was replaced mid-run. There is no resume; start
   a new run. Because nothing is written by a failed run, the previous successful
   snapshots remain.
6. **After recovery**, confirm a new `SUCCESS`/`PARTIAL` run, a recent last-sync date,
   and a green line in **Diagnostic**.

### Read the last runs from the database

Safe: it selects status, dates, counters and the stored safe summary; no token, no
ciphertext, no provider payload.

```sh
docker compose exec -T db psql -U "${POSTGRES_USER:-dashboard}" -d "${POSTGRES_DB:-dashboard}" -c '
SELECT c.provider, c."instanceUrl", c.status, c."lastSyncedAt", c."lastSyncError",
       r.status AS run_status, r."startedAt", r."finishedAt", r.retries, r."errorSummary"
FROM "IntegrationConnection" c
LEFT JOIN LATERAL (
  SELECT * FROM "SyncRun" s
  WHERE s."connectionId" = c.id
  ORDER BY s."startedAt" DESC
  LIMIT 1
) r ON true
ORDER BY c.provider
LIMIT 20;'
```

The database container accepts `psql -U dashboard` over its local socket; no password
is needed inside it, and none should be put on the command line.

### Self-hosted GitLab or network errors

Check reachability from the application container, without any token:

```sh
docker compose exec app node -e \
  "fetch('https://gitlab.example.test/api/v4/version').then(r => console.log(r.status)).catch(e => console.log(e.name))"
```

Use the real instance URL, which is not a secret, only where it is needed. A failure
here is DNS, routing, TLS trust or an egress firewall, not a token problem.

## When the data looks wrong even though the run succeeded

- **A repository disappeared from the list**: snapshots are current state. A run
  replaces them, and a repository no longer returned by the provider (deleted, access
  removed, outside the selected organisation/group) is pruned after a complete read.
  This is expected; it is not data loss in the budget.
- **Counters look small**: the issue and milestone scan is bounded to the 20 most
  recently pushed repositories. The rest are reported as `skipped` (never as "nothing
  open") and are read once they move back into that selection. GitLab does not fetch
  issues at all in this version, by design.
- **A `304 Not Modified` keeps the old dates**: the repository was checked and did not
  change. The page shows when it was last checked versus last changed.
- **Stale is not broken**: the last successful data is displayed with its date. It is
  never replaced by a zero.

## Do not

- Do not delete the connection, its snapshots or `SyncRun` rows to make the page look
  green. Deleting history removes the evidence; deleting snapshots makes the dashboard
  claim there is no data.
- Do not edit `lastSyncError` or status columns by hand.
- Do not run a synchronisation with a token that has write permissions. Read-only scopes
  are sufficient and intentional.
- Do not put the token in a command, a log or a ticket.

## History retention

Run history is kept for 90 days, except the most recent successful run of each
connection. Cleanup is manual and safe to re-run:

```sh
npm run db:cleanup
# or, with the database tooling image:
docker compose --profile full run --rm migrate npm run db:cleanup
```

Nothing schedules it. Provider snapshots are current state, not history, and are not
subject to this retention.
