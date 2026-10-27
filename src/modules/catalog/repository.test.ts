import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();
const upsertMock = vi.fn();

// Only `workspaceModule` exists on this fake client: a write to any other table
// (a module's own records) would throw instead of passing silently.
vi.mock("@/lib/db", () => ({
  getPrisma: () => ({ workspaceModule: { findMany: findManyMock, upsert: upsertMock } }),
}));

const { applyModuleChange } = await import("./repository");

describe("applyModuleChange", () => {
  beforeEach(() => {
    findManyMock.mockReset().mockResolvedValue([]);
    upsertMock.mockReset().mockResolvedValue({});
  });

  it("enables a module by writing its activation row only, scoped to the workspace", async () => {
    expect(await applyModuleChange("ws-1", { key: "budget", enabled: true })).toMatchObject({
      status: "ok",
    });

    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "ws-1" } }));
    expect(upsertMock).toHaveBeenCalledWith({
      where: { workspaceId_moduleKey: { workspaceId: "ws-1", moduleKey: "budget" } },
      create: { workspaceId: "ws-1", moduleKey: "budget", enabled: true, config: undefined },
      update: { enabled: true, config: undefined },
    });
  });

  it("disables by flipping the flag, keeping the stored configuration", async () => {
    findManyMock.mockResolvedValue([{ moduleKey: "budget", enabled: true }]);

    await applyModuleChange("ws-1", { key: "budget", enabled: false });

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ update: { enabled: false, config: undefined } }),
    );
  });

  it("writes nothing for an unknown key or a missing prerequisite", async () => {
    expect((await applyModuleChange("ws-1", { key: "billing", enabled: true })).status).toBe(
      "unknown_module",
    );
    expect((await applyModuleChange("ws-1", { key: "profitability", enabled: true })).status).toBe(
      "missing_prerequisites",
    );
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
