import { getPrisma } from "@/lib/db";

/**
 * Persisted sessions.
 *
 * The JWT stays the proof of identity; this table is the revocation list the owner
 * can actually see and act on. Only a coarse client label and three instants are
 * stored — never the token, a user agent, an address or a fingerprint.
 */

/** A session is written on every validated request at most this often. */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type PersistedSession = {
  id: string;
  client: "WEB" | "MOBILE" | "UNKNOWN";
  createdAt: Date;
  lastSeenAt: Date;
};

/** Session + owner in one query: the guard needs both on every authenticated request. */
export type SessionWithOwner = {
  id: string;
  lastSeenAt: Date;
  user: {
    id: string;
    email: string;
    name: string | null;
    passwordHash: string;
  };
};

export async function createSession(
  userId: string,
  client: PersistedSession["client"],
): Promise<string> {
  const session = await getPrisma().session.create({
    data: { userId, client },
    select: { id: true },
  });

  return session.id;
}

/**
 * Reads a session only when it is active and belongs to `userId`.
 *
 * Scoping by owner here, rather than comparing afterwards, makes a foreign id
 * indistinguishable from an unknown one: both return null.
 */
export async function findActiveSession(
  sessionId: string,
  userId: string,
): Promise<SessionWithOwner | null> {
  return getPrisma().session.findFirst({
    where: { id: sessionId, userId, revokedAt: null },
    select: {
      id: true,
      lastSeenAt: true,
      user: { select: { id: true, email: true, name: true, passwordHash: true } },
    },
  });
}

/**
 * Records a successfully validated request, at most every `SESSION_TOUCH_INTERVAL_MS`.
 *
 * Writing on every request would turn each page view into an extra write for a
 * timestamp nobody reads at second precision.
 */
export async function touchSession(
  sessionId: string,
  userId: string,
  lastSeenAt: Date,
  now: Date = new Date(),
): Promise<void> {
  if (now.getTime() - lastSeenAt.getTime() < SESSION_TOUCH_INTERVAL_MS) {
    return;
  }

  await getPrisma().session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { lastSeenAt: now },
  });
}

export async function listActiveSessions(userId: string): Promise<PersistedSession[]> {
  return getPrisma().session.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, client: true, createdAt: true, lastSeenAt: true },
  });
}

/** Scoped by owner: a foreign id matches no row and is reported as false. */
export async function revokeSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const { count } = await getPrisma().session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return count === 1;
}

/** Revokes every active session except the one making the request. */
export async function revokeOtherSessions(
  userId: string,
  keepSessionId: string,
): Promise<number> {
  const { count } = await getPrisma().session.updateMany({
    where: { userId, revokedAt: null, id: { not: keepSessionId } },
    data: { revokedAt: new Date() },
  });

  return count;
}
