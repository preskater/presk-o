import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Password changes revoke every active session.
 *
 * The database is mocked: what matters here is that the hash replacement and the
 * revocation are written together, scoped to the owner, so no session survives a
 * password change even though the token fingerprint already refuses it.
 */

const updateUserMock = vi.fn();
const updateSessionMock = vi.fn();
const transactionMock = vi.fn();

const prisma = {
  user: { updateMany: updateUserMock },
  session: { updateMany: updateSessionMock },
  $transaction: transactionMock,
};

vi.mock("@/lib/db", () => ({ getPrisma: () => prisma }));

const { updateOwnerPassword } = await import("./repository");

describe("updateOwnerPassword", () => {
  beforeEach(() => {
    updateUserMock.mockReset().mockResolvedValue({ count: 1 });
    updateSessionMock.mockReset().mockResolvedValue({ count: 2 });
    transactionMock
      .mockReset()
      .mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations));
  });

  it("replaces the hash and revokes every active session in one transaction", async () => {
    expect(await updateOwnerPassword("owner-1", "$2b$12$replacement")).toBe(true);

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: "owner-1" },
      data: { passwordHash: "$2b$12$replacement" },
    });
    expect(updateSessionMock).toHaveBeenCalledWith({
      where: { userId: "owner-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("reports an owner row that no longer exists instead of answering success", async () => {
    updateUserMock.mockResolvedValue({ count: 0 });

    expect(await updateOwnerPassword("recreated-away", "$2b$12$replacement")).toBe(false);
  });
});
