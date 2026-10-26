import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { passwordTag } from "@/lib/auth/password";
import { hasModule, type ModuleKey } from "@/modules/catalog/catalog";
import { findActiveSession, touchSession } from "@/modules/identity/sessions";
import { findOwnerById, listMemberships } from "@/modules/identity/repository";
import { type ActiveWorkspace, resolveActiveWorkspace } from "@/modules/identity/workspace";

/**
 * Server-side authorisation.
 *
 * Hiding a link in the interface is not protection: every page, Route Handler
 * and Server Action that touches the budget, the properties or a private
 * repository calls one of these functions first.
 *
 * A signed token can outlive the row it names: recreating the database (new
 * volume, reset, re-seed) issues new identifiers while browsers keep the previous
 * cookie. Such a session is treated as signed out — one indexed lookup — instead
 * of reaching pages that read nothing and writes that fail on a foreign key.
 *
 * The same lookup answers three questions, in this order:
 * 1. does the persisted session row still exist, and is it active?
 * 2. does it belong to the owner named by the token?
 * 3. does the token belong to the current password?
 *
 * The last one uses a fingerprint of the hash the token was issued for (see
 * `passwordTag`), so changing the password signs out every session opened before
 * it, on every device, not only the one that made the change. Revoking a session
 * in the account page is the explicit counterpart: it sets `revokedAt`, and the
 * next request carrying that token is refused here.
 *
 * A token without a session identifier predates persisted sessions and is refused
 * rather than trusted: the cost is one sign-in.
 *
 * Every session also resolves exactly one active workspace from the user's own
 * memberships; a user without any membership is refused like a signed-out one.
 */
export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  /** Persisted session making this request; used to revoke the others. */
  sessionId: string;
  workspace: ActiveWorkspace;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();

  const id = session?.user?.id;
  const email = session?.user?.email;
  const sessionId = session?.sessionId;

  if (!id || !email || !sessionId) {
    return null;
  }

  // One query, scoped by owner: a foreign session id is indistinguishable from an
  // unknown one, a revoked row filters itself out, and a deleted owner cascades its
  // sessions away. `user` is the row the token claims to name.
  const record = await findActiveSession(sessionId, id);
  if (!record) {
    return null;
  }

  // The token proves its signature, not that the owner still exists.
  const [owner, memberships] = await Promise.all([findOwnerById(id), listMemberships(id)]);
  if (!owner) {
    return null;
  }

  // Nor that it was issued for the password currently in force. A token without a
  // fingerprint predates this check, and is refused rather than trusted: the cost
  // is one sign-in.
  if (!session.passwordTag || session.passwordTag !== passwordTag(record.user.passwordHash)) {
    return null;
  }

  // ponytail: always the oldest membership; the switcher (second membership) will pass
  // the chosen identifier here.
  const workspace = resolveActiveWorkspace(memberships);
  if (!workspace) {
    return null;
  }

  // Outside the refusal paths: a rejected token must not look like recent activity.
  await touchSession(sessionId, id, record.lastSeenAt);

  return { id, email, name: session.user.name ?? null, sessionId, workspace };
}

/** For pages: redirects an anonymous visitor to the sign-in page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  return user!;
}

/**
 * For a module's pages and Server Actions: the session check of `requireUser`, then
 * the module must be active in the session's workspace. Otherwise the answer is a
 * 404, as for a page that does not exist: the action writes nothing and the page
 * reads nothing. The key is a literal at the call site, never a value from the browser.
 */
export async function requireModule(key: ModuleKey): Promise<SessionUser> {
  const user = await requireUser();

  if (!hasModule(user.workspace, key)) {
    notFound();
  }

  return user;
}

/**
 * For Route Handlers: returns `null` instead of redirecting, so the caller can
 * answer with an explicit 401 rather than an HTML login page.
 */
export async function requireApiUser(): Promise<SessionUser | null> {
  return getSessionUser();
}

/** Shared 404 body for a module that is not active in the session's workspace. */
export function moduleUnavailableResponse(): Response {
  return Response.json(
    { error: "not_found" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

/** Shared 401 body: it reveals nothing about the data behind the endpoint. */
export function unauthorizedResponse(): Response {
  return Response.json(
    { error: "authentication_required" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
