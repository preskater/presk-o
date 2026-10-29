import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleKey } from "@/modules/catalog/catalog";

const budgetReads = {
  listTransactions: vi.fn(),
  countTransactions: vi.fn(),
  listAccounts: vi.fn(),
  listBudgets: vi.fn(),
  listTransactionsForSeries: vi.fn(),
  sumTransactionsByCurrency: vi.fn(),
};
const countPropertiesMock = vi.fn();
const listConnectionsMock = vi.fn();
const listAlertsMock = vi.fn();

vi.mock("@/modules/budget/repository", () => budgetReads);
vi.mock("@/modules/real-estate/repository", () => ({ countProperties: () => countPropertiesMock() }));
vi.mock("@/modules/integrations/repository", () => ({ listConnections: () => listConnectionsMock() }));
vi.mock("@/modules/alerts/repository", () => ({ listAlerts: () => listAlertsMock() }));

const { getDashboardOverview } = await import("./queries");

/** Fictitious alerts, one per module. */
const ALERTS = [
  {
    id: "a-budget",
    kind: "LOW_BALANCE",
    status: "ACTIVE",
    inputs: { accountName: "Compte courant", currency: "EUR", balance: "-10.00", threshold: "0.00" },
    triggeredAt: new Date(Date.UTC(2026, 9, 1)),
  },
  {
    id: "a-dev",
    kind: "STALE_INTEGRATION",
    status: "ACTIVE",
    inputs: {
      provider: "GITHUB",
      instance: "github.com",
      lastSyncedAt: "2026-09-01T00:00:00.000Z",
      daysSince: "44",
      thresholdDays: "3",
    },
    triggeredAt: new Date(Date.UTC(2026, 9, 1)),
  },
];

const now = new Date(Date.UTC(2026, 9, 15, 12));

describe("getDashboardOverview by active modules", () => {
  beforeEach(() => {
    budgetReads.listTransactions.mockReset().mockResolvedValue([]);
    budgetReads.countTransactions.mockReset().mockResolvedValue(0);
    budgetReads.listAccounts.mockReset().mockResolvedValue([]);
    budgetReads.listBudgets.mockReset().mockResolvedValue([]);
    budgetReads.listTransactionsForSeries.mockReset().mockResolvedValue({ transactions: [], truncated: false });
    budgetReads.sumTransactionsByCurrency.mockReset().mockResolvedValue(new Map());
    countPropertiesMock.mockReset().mockResolvedValue(2);
    listConnectionsMock.mockReset().mockResolvedValue([]);
    listAlertsMock.mockReset().mockResolvedValue(ALERTS);
  });

  it("reads and shows every section when all modules are active", async () => {
    const overview = await getDashboardOverview("owner-1", {
      modules: ["budget", "real-estate", "development"],
      now,
    });

    expect(overview.budget?.transactionCount).toBe(0);
    expect(overview.budgetTracking?.totals).toEqual([]);
    expect(overview.realEstate).toEqual({ propertyCount: 2 });
    expect(overview.integrations).toEqual([]);
    expect(overview.alerts.active.map((alert) => alert.id)).toEqual(["a-budget", "a-dev"]);
  });

  it("reads nothing of the inactive modules and hides their sections and alerts", async () => {
    const overview = await getDashboardOverview("owner-1", { modules: ["real-estate"], now });

    for (const read of Object.values(budgetReads)) {
      expect(read).not.toHaveBeenCalled();
    }
    expect(listConnectionsMock).not.toHaveBeenCalled();
    expect(overview.budget).toBeNull();
    expect(overview.budgetTracking).toBeNull();
    expect(overview.integrations).toBeNull();
    expect(overview.realEstate).toEqual({ propertyCount: 2 });
    expect(overview.alerts.active).toEqual([]);
  });

  it.each<[ModuleKey[], string[]]>([
    [[], []],
    [["budget"], ["a-budget"]],
    [["development"], ["a-dev"]],
  ])("with %j shows only the alerts %j", async (modules, ids) => {
    const overview = await getDashboardOverview("owner-1", { modules, now });
    expect(overview.alerts.active.map((alert) => alert.id)).toEqual(ids);
  });
});
