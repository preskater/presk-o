import { beforeEach, describe, expect, it, vi } from "vitest";
import { passwordTag } from "./password";

const authMock = vi.fn();
const findActiveSessionMock = vi.fn();
const touchSessionMock = vi.fn();

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/modules/identity/sessions", () => ({
  findActiveSession: (...args: unknown[]) => findActiveSessionMock(...args),
  touchSession: (...args: unknown[]) => touchSessionMock(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { getSessionUser, requireUser } = await import("./guard");

/** Fictitious owner only. */
const owner = {
  id: "user-1",
  email: "owner@example.test",
  name: "Proprietaire",
  passwordHash: "$2b$12$not-a-real-hash",
};

/** Persisted session row as the guard reads it, joined with its owner. */
const sessionRecord = {
  id: "session-1",
  lastSeenAt: new Date("2026-10-22T10:00:00Z"),
  user: owner,
};

/** A signed token: the JWT, plus the server-side session it names. */
const validSession = {
  user: { id: owner.id, email: owner.email, name: owner.name },
  passwordTag: passwordTag(owner.passwordHash),
  sessionId: sessionRecord.id,
};

/**
 * Fingerprint derived from the stored hash. It is what ties a token to the password
 * in force, so it is recomputed here rather than hard-coded.
 */
const CURRENT_TAG = passwordTag(owner.passwordHash);

describe("getSessionUser", () => {
  beforeEach(() => {
    authMock.mockReset();
    findActiveSessionMock.mockReset().mockResolvedValue(sessionRecord);
    touchSessionMock.mockReset().mockResolvedValue(undefined);
  });

  it("returns null without a session, without touching the database", async () => {
    authMock.mockResolvedValue(null);

    expect(await getSessionUser()).toBeNull();
    expect(findActiveSessionMock).not.toHaveBeenCalled();
  });

  it("returns null when the token carries no user id", async () => {
    authMock.mockResolvedValue({ user: { email: owner.email }, sessionId: "session-1" });

    expect(await getSessionUser()).toBeNull();
    expect(findActiveSessionMock).not.toHaveBeenCalled();
  });

  it("refuses a token issued before persisted sessions existed", async () => {
    // No session identifier: trusting it would bypass every revocation. The cost is
    // one sign-in.
    authMock.mockResolvedValue({
      user: { id: owner.id, email: owner.email },
      passwordTag: CURRENT_TAG,
    });

    expect(await getSessionUser()).toBeNull();
    expect(findActiveSessionMock).not.toHaveBeenCalled();
  });

  it("authenticates a valid session and records the visit", async () => {
    authMock.mockResolvedValue(validSession);

    expect(await getSessionUser()).toEqual({
      id: owner.id,
      email: owner.email,
      name: owner.name,
      sessionId: sessionRecord.id,
    });
    // Both checks are scoped to the owner: a foreign row can never satisfy them.
    expect(findActiveSessionMock).toHaveBeenCalledWith(sessionRecord.id, owner.id);
    expect(touchSessionMock).toHaveBeenCalledWith(
      sessionRecord.id,
      owner.id,
      sessionRecord.lastSeenAt,
    );
  });

  it("refuses a revoked session on the very next request", async () => {
    // The repository filters `revokedAt` out, so the row reads as missing.
    findActiveSessionMock.mockResolvedValue(null);
    authMock.mockResolvedValue(validSession);

    expect(await getSessionUser()).toBeNull();
    expect(touchSessionMock).not.toHaveBeenCalled();
  });

  it("refuses a token whose persisted session record is missing", async () => {
    findActiveSessionMock.mockResolvedValue(null);
    authMock.mockResolvedValue(validSession);

    expect(await getSessionUser()).toBeNull();
  });

  it("refuses a session owned by another account", async () => {
    // The lookup itself is scoped by owner; a foreign session id matches no row.
    findActiveSessionMock.mockResolvedValue(null);
    authMock.mockResolvedValue(validSession);

    expect(await getSessionUser()).toBeNull();
    expect(findActiveSessionMock).toHaveBeenCalledWith(sessionRecord.id, owner.id);
  });

  it("refuses a session whose owner row disappeared", async () => {
    // Deleting the owner cascades its sessions away: the joined lookup finds nothing.
    findActiveSessionMock.mockResolvedValue(null);
    authMock.mockResolvedValue(validSession);

    expect(await getSessionUser()).toBeNull();
  });

  it("treats a session issued before a password change as signed out", async () => {
    // The row is still there, but its hash is no longer the one this token was
    // issued for: the password was changed elsewhere, on another device.
    findActiveSessionMock.mockResolvedValue({
      ...sessionRecord,
      user: { ...owner, passwordHash: "$2b$12$a-previous-and-different-hash" },
    });
    authMock.mockResolvedValue(validSession);

    expect(await getSessionUser()).toBeNull();
    expect(touchSessionMock).not.toHaveBeenCalled();
  });

  it("refuses a token that carries no fingerprint, rather than trusting it", async () => {
    // Tokens issued before this check existed cannot be tied to the current
    // password: one extra sign-in is the price of refusing them.
    authMock.mockResolvedValue({
      user: { id: owner.id, email: owner.email },
      sessionId: sessionRecord.id,
    });

    expect(await getSessionUser()).toBeNull();
  });
});

describe("requireUser", () => {
  beforeEach(() => {
    authMock.mockReset();
    findActiveSessionMock.mockReset().mockResolvedValue(sessionRecord);
    touchSessionMock.mockReset().mockResolvedValue(undefined);
  });

  it("redirects an anonymous visitor to the sign-in page", async () => {
    authMock.mockResolvedValue(null);

    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });

  it("redirects instead of letting a stale session reach a page", async () => {
    findActiveSessionMock.mockResolvedValue(null);
    authMock.mockResolvedValue(validSession);

    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });

  it("lets the owner through", async () => {
    authMock.mockResolvedValue(validSession);

    await expect(requireUser()).resolves.toMatchObject({
      id: owner.id,
      sessionId: sessionRecord.id,
    });
  });
});
