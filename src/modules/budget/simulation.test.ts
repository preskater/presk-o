import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  simulateExpense,
  simulationMonthKeys,
  type SimulationAccount,
  type SimulationInput,
  type SimulationMonthInput,
} from "./simulation";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const CURRENT = "2026-10";

function d(value: string): Decimal {
  return new Decimal(value);
}

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function checking(overrides: Partial<SimulationAccount> = {}): SimulationAccount {
  return {
    id: "checking",
    name: "Compte courant",
    type: "CHECKING",
    currency: "EUR",
    archived: false,
    recordedBalance: d("1000"),
    openingBalance: d("1000"),
    floor: d("0"),
    floorSource: "NONE",
    ...overrides,
  };
}

function month(
  key: string,
  overrides: Partial<SimulationMonthInput> = {},
): SimulationMonthInput {
  return {
    key,
    recorded: [],
    forecast: [],
    budgets: [],
    ...overrides,
  };
}

function input(overrides: Partial<SimulationInput> = {}): SimulationInput {
  const keys = simulationMonthKeys([], NOW).keys;

  return {
    currency: "EUR",
    currentMonthKey: CURRENT,
    accounts: [checking()],
    months: keys.map((key) => month(key)),
    payments: [],
    selectedCategory: null,
    recordedWindowTruncated: false,
    horizonCapped: false,
    forecastWarnings: [],
    ...overrides,
  };
}

describe("simulationMonthKeys", () => {
  it("always covers the current month and the next six", () => {
    const { keys, capped } = simulationMonthKeys([], NOW);

    expect(keys).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
    ]);
    expect(capped).toBe(false);
  });

  it("extends the window to three months after the last payment", () => {
    const { keys } = simulationMonthKeys(
      [{ operationDate: date("2027-06-12") }],
      NOW,
    );

    expect(keys[0]).toBe("2026-10");
    expect(keys[keys.length - 1]).toBe("2027-09");
  });

  it("includes a past payment and caps a very distant one at 24 months", () => {
    const past = simulationMonthKeys([{ operationDate: date("2026-08-12") }], NOW);
    expect(past.keys[0]).toBe("2026-08");

    const distant = simulationMonthKeys([{ operationDate: date("2029-01-12") }], NOW);
    expect(distant.keys).toHaveLength(24);
    expect(distant.capped).toBe(true);
  });
});

describe("simulateExpense", () => {
  it("computes the account, global and current-month impact of one payment", () => {
    const result = simulateExpense(
      input({
        payments: [
          { accountId: "checking", amount: d("125.50"), date: date("2026-10-15"), label: null },
        ],
      }),
    );

    expect(result.summary.currentMonthEndBefore?.toFixed(2)).toBe("1000.00");
    expect(result.summary.currentMonthEndAfter?.toFixed(2)).toBe("874.50");
    expect(result.summary.currentMonthDelta.toFixed(2)).toBe("-125.50");
    expect(result.summary.verdict).toBe("safe");
    expect(result.payments[0]?.balanceBefore?.toFixed(2)).toBe("1000.00");
    expect(result.payments[0]?.balanceAfter?.toFixed(2)).toBe("874.50");
  });

  it("shows each instalment and the cumulative split-payment impact", () => {
    const keys = simulationMonthKeys([], NOW).keys;
    const result = simulateExpense(
      input({
        months: keys.map((key) => month(key)),
        payments: [
          { accountId: "checking", amount: d("100"), date: date("2026-10-10"), label: null },
          { accountId: "checking", amount: d("250"), date: date("2026-11-10"), label: null },
        ],
      }),
    );

    expect(result.totalAmount.toFixed(2)).toBe("350.00");
    expect(result.months[0]?.recordedCount).toBe(0);
    expect(result.months[0]?.forecastCount).toBe(0);
    expect(result.months[0]?.paymentCount).toBe(1);
    expect(result.months[0]?.balanceAfterScenario?.toFixed(2)).toBe("900.00");
    expect(result.months[1]?.balanceAfterScenario?.toFixed(2)).toBe("650.00");
    expect(result.payments[1]?.balanceBefore?.toFixed(2)).toBe("900.00");
    expect(result.payments[1]?.balanceAfter?.toFixed(2)).toBe("650.00");
    expect(result.payments[1]?.accountCumulative.toFixed(2)).toBe("350.00");
  });

  it("includes pending forecasts and the currency-level salary without counting it on an account", () => {
    const keys = simulationMonthKeys([], NOW).keys;
    const result = simulateExpense(
      input({
        months: keys.map((key) =>
          key === CURRENT
            ? month(key, {
                recorded: [
                  {
                    accountId: "checking",
                    currency: "EUR",
                    amount: d("-50"),
                    date: date("2026-10-05"),
                  },
                ],
                forecast: [
                  {
                    accountId: "checking",
                    currency: "EUR",
                    amount: d("-100"),
                    date: date("2026-10-20"),
                    label: "Abonnement",
                  },
                  {
                    accountId: null,
                    currency: "EUR",
                    amount: d("2000"),
                    date: date("2026-10-31"),
                    label: "Salaire simulé",
                  },
                ],
              })
            : month(key),
        ),
        payments: [
          { accountId: "checking", amount: d("300"), date: date("2026-10-15"), label: null },
        ],
      }),
    );

    expect(result.months[0]?.recordedCount).toBe(1);
    expect(result.months[0]?.forecastCount).toBe(2);
    expect(result.months[0]?.paymentCount).toBe(1);
    expect(result.months[0]?.recordedNet.toFixed(2)).toBe("-50.00");
    expect(result.months[0]?.forecastIncome.toFixed(2)).toBe("2000.00");
    expect(result.months[0]?.forecastExpense.toFixed(2)).toBe("100.00");
    expect(result.months[0]?.balanceBeforeScenario?.toFixed(2)).toBe("2850.00");
    expect(result.months[0]?.balanceAfterScenario?.toFixed(2)).toBe("2550.00");
    expect(result.accounts[0]?.currentMonthEndBefore?.toFixed(2)).toBe("850.00");
    expect(result.accounts[0]?.currentMonthEndAfter?.toFixed(2)).toBe("550.00");
    expect(result.payments[0]?.balanceBefore?.toFixed(2)).toBe("950.00");
    expect(result.payments[0]?.balanceAfter?.toFixed(2)).toBe("650.00");
  });

  it("keeps an account without operations unknown instead of inventing a zero", () => {
    const result = simulateExpense(
      input({
        accounts: [
          checking({
            recordedBalance: null,
            openingBalance: null,
          }),
        ],
        payments: [
          { accountId: "checking", amount: d("20"), date: date("2026-10-15"), label: null },
        ],
      }),
    );

    expect(result.summary.verdict).toBe("unknown");
    expect(result.summary.currentMonthEndAfter).toBeNull();
    expect(result.payments[0]?.balanceAfter).toBeNull();
    expect(result.accounts[0]?.thresholdBreached).toBeNull();
    expect(result.warnings.join(" ")).toContain("inconnu");
  });

  it("reports a threshold breach caused by the scenario", () => {
    const result = simulateExpense(
      input({
        accounts: [checking({ recordedBalance: d("500"), openingBalance: d("500") })],
        payments: [
          { accountId: "checking", amount: d("550"), date: date("2026-10-15"), label: null },
        ],
      }),
    );

    expect(result.summary.verdict).toBe("breach");
    expect(result.summary.firstThresholdBreach?.causedByScenario).toBe(true);
    expect(result.summary.firstThresholdBreach?.amount.toFixed(2)).toBe("-50.00");
    expect(result.payments[0]?.thresholdBreached).toBe(true);
    expect(result.accounts[0]?.thresholdCausedByScenario).toBe(true);
  });

  it("distinguishes a pre-existing threshold breach from a new one", () => {
    const result = simulateExpense(
      input({
        accounts: [
          checking({
            recordedBalance: d("100"),
            openingBalance: d("100"),
            floor: d("200"),
            floorSource: "ACCOUNT",
          }),
        ],
        payments: [
          { accountId: "checking", amount: d("10"), date: date("2026-10-15"), label: null },
        ],
      }),
    );

    expect(result.summary.verdict).toBe("breach");
    expect(result.summary.firstThresholdBreach?.causedByScenario).toBe(false);
    expect(result.accounts[0]?.thresholdCausedByScenario).toBe(false);
    expect(result.warnings.join(" ")).toContain("même sans ce scénario");
  });

  it("suggests a split, using checking before savings", () => {
    const result = simulateExpense(
      input({
        accounts: [
          checking({ id: "checking", name: "Compte courant" }),
          checking({
            id: "savings",
            name: "Livret",
            type: "SAVINGS",
            recordedBalance: d("5000"),
            openingBalance: d("5000"),
          }),
        ],
        payments: [
          { accountId: null, amount: d("300"), date: date("2026-10-15"), label: null },
        ],
      }),
    );

    expect(result.payments[0]?.accountId).toBeNull();
    expect(result.payments[0]?.accountName).toBe("Répartition suggérée");
    expect(
      result.payments[0]?.allocations.map((allocation) => [
        allocation.accountId,
        allocation.amount.toFixed(2),
      ]),
    ).toEqual([["checking", "300.00"]]);
    expect(result.accounts.find((account) => account.id === "checking")?.paymentsTotal.toFixed(2)).toBe("300.00");
  });

  it("preserves the threshold floor when the split can, then uses the next account", () => {
    const result = simulateExpense(
      input({
        accounts: [
          checking({
            id: "checking",
            recordedBalance: d("1000"),
            openingBalance: d("1000"),
            floor: d("500"),
            floorSource: "ACCOUNT",
          }),
          checking({
            id: "savings",
            name: "Livret",
            type: "SAVINGS",
            recordedBalance: d("5000"),
            openingBalance: d("5000"),
            floor: d("500"),
            floorSource: "ACCOUNT",
          }),
        ],
        payments: [
          { accountId: null, amount: d("800"), date: date("2026-10-15"), label: null },
        ],
      }),
    );

    const allocations = result.payments[0]?.allocations ?? [];
    expect(allocations.map((allocation) => [allocation.accountId, allocation.amount.toFixed(2)])).toEqual([
      ["checking", "500.00"],
      ["savings", "300.00"],
    ]);
    expect(allocations.every((allocation) => allocation.preservesFloor)).toBe(true);
    expect(allocations[0]?.balanceAfter.toFixed(2)).toBe("500.00");
    expect(allocations[1]?.balanceAfter.toFixed(2)).toBe("4700.00");
  });

  it("falls back below the floor only when no account can keep it", () => {
    const result = simulateExpense(
      input({
        accounts: [
          checking({
            id: "checking",
            recordedBalance: d("100"),
            openingBalance: d("100"),
            floor: d("500"),
            floorSource: "ACCOUNT",
          }),
          checking({
            id: "savings",
            name: "Livret",
            type: "SAVINGS",
            recordedBalance: d("50"),
            openingBalance: d("50"),
            floor: d("500"),
            floorSource: "ACCOUNT",
          }),
        ],
        payments: [
          { accountId: null, amount: d("120"), date: date("2026-10-15"), label: null },
        ],
      }),
    );

    const allocations = result.payments[0]?.allocations ?? [];
    expect(allocations.map((allocation) => [allocation.accountId, allocation.amount.toFixed(2)])).toEqual([
      ["checking", "100.00"],
      ["savings", "20.00"],
    ]);
    expect(allocations.every((allocation) => allocation.preservesFloor)).toBe(false);
    expect(result.warnings.join(" ")).toContain("ne maintient pas le seuil");
  });

  it("skips archived and unknown accounts when suggesting a split", () => {
    const result = simulateExpense(
      input({
        accounts: [
          checking(),
          checking({
            id: "unknown",
            name: "Compte sans historique",
            recordedBalance: null,
            openingBalance: null,
          }),
          checking({
            id: "archived",
            name: "Ancien compte",
            archived: true,
            recordedBalance: d("5000"),
            openingBalance: d("5000"),
          }),
        ],
        payments: [
          { accountId: null, amount: d("200"), date: date("2026-10-15"), label: null },
        ],
      }),
    );

    expect(result.payments[0]?.allocations.map((allocation) => allocation.accountId)).toEqual([
      "checking",
    ]);
    expect(result.warnings.join(" ")).toContain("Comptes ignorés");
  });

  it("reports an amount that cannot be allocated when no account has a known balance", () => {
    const result = simulateExpense(
      input({
        accounts: [
          checking({ recordedBalance: null, openingBalance: null }),
        ],
        payments: [
          { accountId: null, amount: d("100"), date: date("2026-10-15"), label: null },
        ],
      }),
    );

    expect(result.payments[0]?.allocations).toEqual([]);
    expect(result.payments[0]?.unallocatedAmount.toFixed(2)).toBe("100.00");
    expect(result.summary.verdict).toBe("unknown");
    expect(result.warnings.join(" ")).toContain("reste non répartie");
  });

  it("flags an account that becomes negative without an applicable threshold", () => {
    const result = simulateExpense(
      input({
        accounts: [checking({ recordedBalance: d("50"), openingBalance: d("50") })],
        payments: [
          { accountId: "checking", amount: d("100"), date: date("2026-10-15"), label: null },
        ],
      }),
    );

    expect(result.summary.verdict).toBe("breach");
    expect(result.accounts[0]?.floorSource).toBe("NONE");
    expect(result.summary.thresholds.noneCount).toBe(1);
    expect(result.warnings.join(" ")).toContain("négatif");
  });

  it("computes the budget impact per month, including an overrun", () => {
    const keys = simulationMonthKeys([], NOW).keys;
    const result = simulateExpense(
      input({
        months: keys.map((key) => {
          if (key === "2026-10") {
            return month(key, {
              budgets: [
                {
                  categoryId: "equipment",
                  currency: "EUR",
                  planned: d("300"),
                  actualBefore: d("50"),
                  thresholdPercent: d("80"),
                },
              ],
            });
          }
          if (key === "2026-11") {
            return month(key, {
              budgets: [
                {
                  categoryId: "equipment",
                  currency: "EUR",
                  planned: d("200"),
                  actualBefore: d("0"),
                  thresholdPercent: d("80"),
                },
              ],
            });
          }
          return month(key);
        }),
        payments: [
          { accountId: "checking", amount: d("100"), date: date("2026-10-10"), label: null },
          { accountId: "checking", amount: d("250"), date: date("2026-11-10"), label: null },
        ],
        selectedCategory: { id: "equipment", name: "Équipement" },
      }),
    );

    expect(result.budget?.categoryName).toBe("Équipement");
    expect(result.budget?.hasBudget).toBe(true);
    expect(result.budget?.rows[0]?.actualAfter.toFixed(2)).toBe("150.00");
    expect(result.budget?.rows[0]?.remainingAfter?.toFixed(2)).toBe("150.00");
    expect(result.budget?.rows[0]?.status).toBe("ok");
    expect(result.budget?.rows[1]?.actualAfter.toFixed(2)).toBe("250.00");
    expect(result.budget?.rows[1]?.remainingAfter?.toFixed(2)).toBe("-50.00");
    expect(result.budget?.rows[1]?.status).toBe("overrun");
    expect(result.budget?.rows[2]?.status).toBe("none");
  });

  it("distinguishes a missing budget from a zero envelope", () => {
    const keys = simulationMonthKeys([], NOW).keys;
    const result = simulateExpense(
      input({
        months: keys.map((key) => month(key)),
        payments: [
          { accountId: "checking", amount: d("75"), date: date("2026-10-10"), label: null },
        ],
        selectedCategory: { id: "equipment", name: "Équipement" },
      }),
    );

    expect(result.budget?.hasBudget).toBe(false);
    expect(result.budget?.rows[0]?.planned).toBeNull();
    expect(result.budget?.rows[0]?.simulatedExpense.toFixed(2)).toBe("75.00");
    expect(result.budget?.rows[0]?.status).toBe("none");
  });
});
