import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The audit write is scoped to its workspace and only stores redacted metadata.
 * The database is mocked: what matters is the data handed to it, not Prisma itself.
 */
const createMock = vi.fn();
const prisma = { auditEvent: { create: (...args: unknown[]) => createMock(...args) } };

vi.mock("@/lib/db", () => ({ getPrisma: () => prisma }));

const { recordAuditEvent } = await import("./repository");

describe("recordAuditEvent", () => {
  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({ id: "audit-1" });
  });

  it("writes one owner-scoped entry with redacted metadata", async () => {
    await recordAuditEvent({
      workspaceId: "ws-1",
      actorId: "owner-1",
      action: "export.transactions",
      entityType: "EXPORT",
      outcome: "SUCCESS",
      metadata: { entity: "transactions", rows: 12, label: "Loyer" },
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const [call] = createMock.mock.calls[0] as [{ data: Record<string, unknown> }];

    expect(call.data).toMatchObject({
      workspaceId: "ws-1",
      actorId: "owner-1",
      action: "export.transactions",
      entityType: "EXPORT",
      entityId: null,
      outcome: "SUCCESS",
    });
    // The label is dropped, the count stays: the trail never becomes a second ledger.
    expect(call.data.metadata).toEqual({ entity: "transactions", rows: 12 });
  });

  it("keeps an entry without an actor, for a job or a scheduler", async () => {
    await recordAuditEvent({
      workspaceId: "ws-1",
      actorId: null,
      action: "export.alerts",
      entityType: "EXPORT",
      entityId: "alerts",
      outcome: "REFUSED",
    });

    const [call] = createMock.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(call.data).toMatchObject({ actorId: null, entityId: "alerts", outcome: "REFUSED" });
    expect(call.data.metadata).toEqual({});
  });

  it("lets a write failure reach the caller, which decides whether to proceed", async () => {
    createMock.mockRejectedValue(new Error("audit table unavailable"));

    await expect(
      recordAuditEvent({
        workspaceId: "ws-1",
        actorId: "owner-1",
        action: "export.goals",
        entityType: "EXPORT",
        outcome: "SUCCESS",
      }),
    ).rejects.toThrow("audit table unavailable");
  });
});
