# Persisted sessions

The dashboard keeps one row per signed-in browser so the owner can see and revoke
sessions. Auth.js still issues the JWT and stays the identity provider; the row is
the revocation list, not a second token store.

## Data model

`Session` (see `prisma/schema.prisma`):

| Field        | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `id`         | Server-generated cuid, carried in the JWT only after a successful login |
| `userId`     | Owner, `ON DELETE CASCADE`                                              |
| `client`     | Coarse label `WEB`, `MOBILE` or `UNKNOWN`, derived from the User-Agent at sign-in |
| `createdAt`  | Session creation instant (UTC)                                          |
| `lastSeenAt` | Last successfully validated request, refreshed at most every 5 minutes  |
| `revokedAt`  | `null` while active; set once by a revocation or a password change      |

No token, JWT, full user agent, IP address or fingerprint is stored. Deleting the
owner deletes their sessions.

## Sign-in and token

`authorize()` verifies the password, then creates the row and returns its `id`. The
`jwt` callback copies it into the token as `sessionId` **only when a user is
present**, so a token refresh never rotates or rewrites it. The `session` callback
exposes it to server-side code. A token without `sessionId` predates persisted
sessions and is refused (one-time re-login).

The id is chosen by the server and cannot be supplied by the browser, so it cannot
be fixated.

## Validation flow (`getSessionUser`)

Every protected page, Route Handler and Server Action calls this helper. It:

1. verifies the token through Auth.js;
2. requires `user.id`, `user.email` and `sessionId`;
3. reads the row with **one** owner-scoped query
   (`id = sessionId AND userId = token.sub AND revokedAt IS NULL`) joined with the
   owner row. A missing row, a revoked row, a foreign row and a deleted owner all
   yield `null`;
4. keeps the existing password-fingerprint check (`passwordTag`) against the hash
   read in that same query;
5. refreshes `lastSeenAt` only when it is older than
   `SESSION_TOUCH_INTERVAL_MS` (5 minutes).

A refusal is `null`; pages redirect to `/login`, Route Handlers answer `401`.

## Revocation flow

`/account` lists active rows (label, created, last seen, current marker). Actions in
`src/app/(app)/account/session-actions.ts`:

- `revokeSessionAction({ id })` — Zod validates a non-empty string id, then runs
  `UPDATE … WHERE id = ? AND userId = currentUser AND revokedAt IS NULL`.
  Malformed, unknown, foreign and already-revoked ids all answer
  `Session introuvable.` Revoking the current session is allowed defensively and
  signs the owner out immediately.
- `revokeOtherSessionsAction()` — same scope, excluding the current session id.

Responses use the shared `ActionResult` shape and never contain a token, a JWT or a
session id. The UI asks for confirmation in-page, disables the button while pending,
refreshes the list on success and shows the error otherwise.

Signing out through the navigation also revokes the current row, so a signed-out
device does not linger in the list. A database failure there is logged and does not
prevent the cookie from being cleared.

## Password change

`updateOwnerPassword` replaces the hash and revokes **all** active sessions for that
owner in one transaction. The existing fingerprint check is unchanged, so old tokens
are refused even if the revocation write were somehow skipped: both mechanisms apply.

## Migration impact

`20261022123229_add_sessions` is additive: it creates the enum, the table, one index
and the foreign key; it touches no existing row. Existing JWTs carry no `sessionId`
and are refused on their next request, forcing one sign-in that creates the first
row. This matches the previous `passwordTag` migration behaviour and is intentional.
