import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();
const pruneSyncRunsMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getPrisma: () => ({
    workspace: { findMany: (...args: unknown[]) => findManyMock(...args) },
  }),
}));
vi.mock("@/modules/integrations/repository", () => ({
  pruneSyncRuns: (...args: unknown[]) => pruneSyncRunsMock(...args),
}));

const { cleanUpSyncRuns, retentionCutoff, SYNC_RUN_RETENTION_DAYS } = await import(
  "./retention"
);

describe("retentionCutoff", () => {
  it("subtracts the retention window from the current instant", () => {
    const now = new Date(Date.UTC(2026, 9, 5, 12, 0, 0));

    expect(retentionCutoff(now).toISOString()).toBe("2026-07-07T12:00:00.000Z");
    expect(retentionCutoff(now, 30).toISOString()).toBe("2026-09-05T12:00:00.000Z");
  });

  it("defaults to the documented ninety days", () => {
    expect(SYNC_RUN_RETENTION_DAYS).toBe(90);
  });
});

describe("cleanUpSyncRuns", () => {
  beforeEach(() => {
    findManyMock.mockReset().mockResolvedValue([{ id: "ws-owner-1" }, { id: "ws-owner-2" }]);
    pruneSyncRunsMock.mockReset().mockResolvedValueOnce(3).mockResolvedValueOnce(4);
  });

  it("prunes every workspace with the same cutoff and sums the deletions", async () => {
    const now = new Date(Date.UTC(2026, 9, 5));
    const result = await cleanUpSyncRuns({ now });

    expect(pruneSyncRunsMock).toHaveBeenNthCalledWith(1, {
      workspaceId: "ws-owner-1",
      olderThan: retentionCutoff(now),
    });
    expect(pruneSyncRunsMock).toHaveBeenNthCalledWith(2, {
      workspaceId: "ws-owner-2",
      olderThan: retentionCutoff(now),
    });
    expect(result).toEqual({ workspaces: 2, deleted: 7 });
  });

  it("is a no-op when no workspace exists yet", async () => {
    findManyMock.mockResolvedValue([]);

    expect(await cleanUpSyncRuns()).toEqual({ workspaces: 0, deleted: 0 });
    expect(pruneSyncRunsMock).not.toHaveBeenCalled();
  });
});
