import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { buildDailyBalance, carryOverNet, daysInMonth } from "./evolution";

/** Fictitious values only. Dates are calendar days at UTC midnight, like the app. */
function day(year: number, month: number, value: number): Date {
  return new Date(Date.UTC(year, month - 1, value));
}

/** 2026-10: a 31-day month. */
const OCTOBER = { year: 2026, month: 10 };

describe("daysInMonth", () => {
  it("counts the real days of the month, leap years included", () => {
    expect(daysInMonth(2026, 10)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
  });
});

describe("buildDailyBalance", () => {
  it("draws one flat point per day when nothing moves", () => {
    const points = buildDailyBalance({
      ...OCTOBER,
      opening: new Decimal("500.00"),
      recorded: [],
      pending: [],
    });

    expect(points).toHaveLength(31);
    expect(points[0].day).toBe(1);
    expect(points[0].recorded.toFixed(2)).toBe("500.00");
    expect(points[30].recorded.toFixed(2)).toBe("500.00");
    expect(points[30].echeances.toFixed(2)).toBe("0.00");
    expect(points[30].projected.toFixed(2)).toBe("500.00");
  });

  it("applies a recorded operation on its day and carries it forward", () => {
    const points = buildDailyBalance({
      ...OCTOBER,
      opening: new Decimal("1000.00"),
      recorded: [{ date: day(2026, 10, 10), amount: new Decimal("-250.00") }],
      pending: [],
    });

    expect(points[8].recorded.toFixed(2)).toBe("1000.00"); // 9 October
    expect(points[9].recorded.toFixed(2)).toBe("750.00"); // 10 October
    expect(points[30].recorded.toFixed(2)).toBe("750.00");
    expect(points[9].dayNet.toFixed(2)).toBe("-250.00");
    expect(points[8].dayNet.toFixed(2)).toBe("0.00");
  });

  it("keeps the pending movements out of the recorded line", () => {
    const points = buildDailyBalance({
      ...OCTOBER,
      opening: new Decimal("100.00"),
      recorded: [],
      pending: [{ date: day(2026, 10, 5), amount: new Decimal("-40.00") }],
    });

    expect(points[4].recorded.toFixed(2)).toBe("100.00");
    expect(points[4].projected.toFixed(2)).toBe("60.00");
    expect(points[3].projected.toFixed(2)).toBe("100.00");
    expect(points[4].dayNet.toFixed(2)).toBe("-40.00");
    // The échéances line is their own cumulative, from zero, not a balance.
    expect(points[3].echeances.toFixed(2)).toBe("0.00");
    expect(points[4].echeances.toFixed(2)).toBe("-40.00");
    expect(points[30].echeances.toFixed(2)).toBe("-40.00");
  });

  it("sums several movements of the same day, in either input order", () => {
    const points = buildDailyBalance({
      ...OCTOBER,
      opening: new Decimal("0"),
      recorded: [
        { date: day(2026, 10, 3), amount: new Decimal("200.00") },
        { date: day(2026, 10, 3), amount: new Decimal("-50.00") },
      ],
      pending: [{ date: day(2026, 10, 3), amount: new Decimal("10.00") }],
    });

    expect(points[2].recorded.toFixed(2)).toBe("150.00");
    expect(points[2].echeances.toFixed(2)).toBe("10.00");
    expect(points[2].projected.toFixed(2)).toBe("160.00");
    expect(points[2].dayNet.toFixed(2)).toBe("160.00");
  });

  it("carries the previous month's simulation into the simulated line only", () => {
    const points = buildDailyBalance({
      ...OCTOBER,
      opening: new Decimal("1000.00"),
      carryOver: new Decimal("450.00"),
      recorded: [{ date: day(2026, 10, 3), amount: new Decimal("-100.00") }],
      pending: [{ date: day(2026, 10, 9), amount: new Decimal("-50.00") }],
    });

    // Nothing yet on the 1st: the carried simulation is already in the simulated balance.
    expect(points[0].recorded.toFixed(2)).toBe("1000.00");
    expect(points[0].echeances.toFixed(2)).toBe("0.00");
    expect(points[0].projected.toFixed(2)).toBe("1450.00");

    expect(points[2].recorded.toFixed(2)).toBe("900.00");
    expect(points[2].projected.toFixed(2)).toBe("1350.00");

    expect(points[8].projected.toFixed(2)).toBe("1300.00");
  });

  it("defaults the carry-over to zero, so a month with nothing simulated is unchanged", () => {
    const withoutCarryOver = buildDailyBalance({
      ...OCTOBER,
      opening: new Decimal("200.00"),
      recorded: [{ date: day(2026, 10, 5), amount: new Decimal("20.00") }],
      pending: [],
    });
    const explicitZero = buildDailyBalance({
      ...OCTOBER,
      opening: new Decimal("200.00"),
      carryOver: new Decimal(0),
      recorded: [{ date: day(2026, 10, 5), amount: new Decimal("20.00") }],
      pending: [],
    });

    expect(withoutCarryOver[4].projected.toFixed(2)).toBe("220.00");
    expect(explicitZero[4].projected.toFixed(2)).toBe("220.00");
  });

  it("keeps the three series consistent: simulated = recorded + échéances (+ carry-over)", () => {
    const points = buildDailyBalance({
      ...OCTOBER,
      opening: new Decimal("300.00"),
      recorded: [{ date: day(2026, 10, 4), amount: new Decimal("120.00") }],
      pending: [
        { date: day(2026, 10, 6), amount: new Decimal("-80.00") },
        { date: day(2026, 10, 12), amount: new Decimal("-55.50") },
      ],
    });

    for (const point of points) {
      expect(point.projected.toFixed(2)).toBe(
        point.recorded.plus(point.echeances).toFixed(2),
      );
    }

    expect(points[11].recorded.toFixed(2)).toBe("420.00");
    expect(points[11].echeances.toFixed(2)).toBe("-135.50");
    expect(points[11].projected.toFixed(2)).toBe("284.50");
  });

  it("can go below zero when the month spends more than the opening balance", () => {
    const points = buildDailyBalance({
      ...OCTOBER,
      opening: new Decimal("50.00"),
      recorded: [{ date: day(2026, 10, 31), amount: new Decimal("-80.00") }],
      pending: [],
    });

    expect(points[30].recorded.toFixed(2)).toBe("-30.00");
    expect(points[30].projected.toFixed(2)).toBe("-30.00");
  });

  it("refuses a movement dated outside the month instead of drawing it elsewhere", () => {
    expect(() =>
      buildDailyBalance({
        ...OCTOBER,
        opening: new Decimal("0"),
        recorded: [{ date: day(2026, 11, 1), amount: new Decimal("10.00") }],
        pending: [],
      }),
    ).toThrow(/outside 2026-10/);
  });
});

describe("carryOverNet", () => {
  it("carries the previous month's pending movements, signed, per currency", () => {
    const carry = carryOverNet([
      { currency: "EUR", type: "INCOME", amount: new Decimal("1850.00"), status: "PENDING" },
      { currency: "EUR", type: "EXPENSE", amount: new Decimal("950.00"), status: "PENDING" },
      { currency: "USD", type: "INCOME", amount: new Decimal("100.00"), status: "PENDING" },
    ]);

    expect(carry.get("EUR")?.toFixed(2)).toBe("900.00");
    expect(carry.get("USD")?.toFixed(2)).toBe("100.00");
  });

  it("ignores anything already recorded or explicitly dropped", () => {
    const carry = carryOverNet([
      // A booked salary is a recorded operation: carrying it would count it twice.
      { currency: "EUR", type: "INCOME", amount: new Decimal("2000.00"), status: "CONFIRMED" },
      { currency: "EUR", type: "EXPENSE", amount: new Decimal("120.00"), status: "SKIPPED" },
      { currency: "EUR", type: "EXPENSE", amount: new Decimal("80.00"), status: "DISMISSED" },
      { currency: "EUR", type: "EXPENSE", amount: new Decimal("30.00"), status: "PENDING" },
    ]);

    expect(carry.get("EUR")?.toFixed(2)).toBe("-30.00");
  });

  it("returns no currency at all when nothing is pending", () => {
    expect(carryOverNet([]).size).toBe(0);
    expect(
      carryOverNet([
        { currency: "EUR", type: "INCOME", amount: new Decimal("500.00"), status: "CONFIRMED" },
      ]).size,
    ).toBe(0);
  });
});
