import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Session persistence queries.
 *
 * These assertions are about scoping and shape: every mutation is narrowed to the
 * signed-in owner, and no query ever selects token material, a user agent or an
 * address. The database itself is mocked; no test needs a real server.
 */

const createMock = vi.fn();
const findFirstMock = vi.fn();
const findManyMock = vi.fn();
const updateManyMock = vi.fn();

const prisma = {
  session: {
    create: createMock,
    findFirst: findFirstMock,
    findMany: findManyMock,
    updateMany: updateManyMock,
  },
};

vi.mock("@/lib/db", () => ({ getPrisma: () => prisma }));

const {
  createSession,
  findActiveSession,
  listActiveSessions,
  revokeOtherSessions,
  revokeSession,
  touchSession,
  SESSION_TOUCH_INTERVAL_MS,
} = await import("./sessions");

describe("session persistence", () => {
  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({ id: "session-new" });
    findFirstMock.mockReset().mockResolvedValue(null);
    findManyMock.mockReset().mockResolvedValue([]);
    updateManyMock.mockReset().mockResolvedValue({ count: 1 });
  });

  it("creates a session with a coarse client label only", async () => {
    expect(await createSession("owner-1", "MOBILE")).toBe("session-new");

    expect(createMock).toHaveBeenCalledWith({
      data: { userId: "owner-1", client: "MOBILE" },
      select: { id: true },
    });
    // No token, user agent, address or fingerprint is ever written.
    expect(JSON.stringify(createMock.mock.calls[0])).not.toMatch(
      /token|jwt|agent|ip|fingerprint/i,
    );
  });

  it("reads a session only when it is active and owned by the caller", async () => {
    await findActiveSession("session-1", "owner-1");

    const query = findFirstMock.mock.calls[0][0];

    expect(query.where).toEqual({
      id: "session-1",
      userId: "owner-1",
      revokedAt: null,
    });
    // The page displays dates and a label; the token never leaves the cookie.
    expect(JSON.stringify(query.select)).not.toMatch(/token|jwt|agent|fingerprint/i);
  });

  it("scopes a single revocation to the owner", async () => {
    expect(await revokeSession("owner-1", "session-1")).toBe(true);

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "session-1", userId: "owner-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("reports a foreign or already revoked session as not found", async () => {
    updateManyMock.mockResolvedValue({ count: 0 });

    expect(await revokeSession("owner-1", "someone-elses-session")).toBe(false);
  });

  it("revokes the other sessions without touching the current one", async () => {
    updateManyMock.mockResolvedValue({ count: 2 });

    expect(await revokeOtherSessions("owner-1", "session-current")).toBe(2);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        userId: "owner-1",
        revokedAt: null,
        id: { not: "session-current" },
      },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("lists active sessions without selecting any token material", async () => {
    await listActiveSessions("owner-1");

    const query = findManyMock.mock.calls[0][0];

    expect(query.where).toEqual({ userId: "owner-1", revokedAt: null });
    expect(query.select).toEqual({
      id: true,
      client: true,
      createdAt: true,
      lastSeenAt: true,
    });
  });

  it("does not write lastSeenAt on every request", async () => {
    const lastSeenAt = new Date("2026-10-22T10:00:00Z");

    await touchSession("session-1", "owner-1", lastSeenAt, new Date("2026-10-22T10:01:00Z"));

    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("refreshes lastSeenAt once the interval has elapsed", async () => {
    const lastSeenAt = new Date("2026-10-22T10:00:00Z");
    const now = new Date(lastSeenAt.getTime() + SESSION_TOUCH_INTERVAL_MS);

    await touchSession("session-1", "owner-1", lastSeenAt, now);

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "session-1", userId: "owner-1", revokedAt: null },
      data: { lastSeenAt: now },
    });
  });
});
