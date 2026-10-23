import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock, runDiagnosticsMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  runDiagnosticsMock: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({ requireUser: requireUserMock }));
vi.mock("@/modules/diagnostics/run", () => ({ runDiagnostics: runDiagnosticsMock }));

const { default: DiagnosticsPage, dynamic } = await import("./page");

class RedirectSignal extends Error {}

describe("diagnostics page", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    runDiagnosticsMock.mockReset();
  });

  it("runs nothing without a session: requireUser redirects first", async () => {
    requireUserMock.mockRejectedValue(new RedirectSignal("/login"));

    await expect(DiagnosticsPage()).rejects.toBeInstanceOf(RedirectSignal);
    expect(runDiagnosticsMock).not.toHaveBeenCalled();
  });

  it("runs the diagnostics for the signed-in owner only", async () => {
    requireUserMock.mockResolvedValue({ id: "owner-fixture", email: "owner@example.test", name: null });
    runDiagnosticsMock.mockResolvedValue({ status: "ok", checks: [], generatedAt: "2026-10-23T12:00:00.000Z" });

    await DiagnosticsPage();
    expect(runDiagnosticsMock).toHaveBeenCalledWith("owner-fixture");
  });

  it("is never served from a static cache", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
