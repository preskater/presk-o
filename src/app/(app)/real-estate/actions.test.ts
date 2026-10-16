import Decimal from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const findPropertyMock = vi.fn();
const findLoanMock = vi.fn();
const createLoanMock = vi.fn();
const updateLoanMock = vi.fn();
const deleteLoanMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth/guard", () => ({ requireUser: () => requireUserMock() }));
vi.mock("@/modules/real-estate/repository", () => ({
  createProperty: vi.fn(),
  createCashflow: vi.fn(),
  findProperty: (...args: unknown[]) => findPropertyMock(...args),
  findLoan: (...args: unknown[]) => findLoanMock(...args),
  createLoan: (...args: unknown[]) => createLoanMock(...args),
  updateLoan: (...args: unknown[]) => updateLoanMock(...args),
  deleteLoan: (...args: unknown[]) => deleteLoanMock(...args),
}));
vi.mock("@/modules/budget/repository", () => ({ findTransactionRef: vi.fn() }));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const { createLoanAction, updateLoanAction, deleteLoanAction } = await import("./actions");

/**
 * Fictitious data only. Authorisation and ownership are decided in the action, so it
 * is exercised against mocked repositories: no test touches a database.
 */
const OWNER = { id: "owner-1", email: "owner@example.test", name: null };

const validLoan = {
  propertyId: "property-1",
  label: "Crédit immobilier",
  currency: "EUR",
  initialPrincipal: "250000,00",
  outstandingBalance: "198500,00",
  balanceAsOf: "2026-01-01",
  interestRate: "3,45",
  termMonths: "240",
  paymentAmount: "1250,00",
  insuranceAmount: "45,00",
  startDate: "2021-06-01",
  endDate: "2041-06-01",
  notes: "",
};

describe("createLoanAction", () => {
  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(OWNER);
    findPropertyMock.mockReset().mockResolvedValue({ id: "property-1", name: "Bien" });
    createLoanMock.mockReset().mockResolvedValue({ id: "loan-1" });
    revalidatePathMock.mockReset();
  });

  it("writes a loan for the owner's property", async () => {
    const result = await createLoanAction(validLoan);

    expect(result.status).toBe("ok");
    expect(findPropertyMock).toHaveBeenCalledWith("owner-1", "property-1");
    expect(createLoanMock).toHaveBeenCalledTimes(1);
    const input = createLoanMock.mock.calls[0][0] as { initialPrincipal: Decimal };
    expect(input.initialPrincipal.toFixed(2)).toBe("250000.00");
    expect(revalidatePathMock).toHaveBeenCalledWith("/real-estate");
  });

  it("refuses a foreign or unknown property and writes nothing", async () => {
    findPropertyMock.mockResolvedValue(null);

    const result = await createLoanAction(validLoan);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/introuvable/i);
    expect(createLoanMock).not.toHaveBeenCalled();
  });

  it("refuses an invalid payload before any lookup", async () => {
    const result = await createLoanAction({ ...validLoan, initialPrincipal: "-5" });

    expect(result.status).toBe("invalid");
    expect(findPropertyMock).not.toHaveBeenCalled();
    expect(createLoanMock).not.toHaveBeenCalled();
  });
});

describe("updateLoanAction", () => {
  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(OWNER);
    findPropertyMock.mockReset().mockResolvedValue({ id: "property-1", name: "Bien" });
    findLoanMock.mockReset().mockResolvedValue({ id: "loan-1" });
    updateLoanMock.mockReset().mockResolvedValue(true);
    revalidatePathMock.mockReset();
  });

  it("updates an owner-scoped loan", async () => {
    const result = await updateLoanAction({ ...validLoan, id: "loan-1" });

    expect(result.status).toBe("ok");
    expect(updateLoanMock).toHaveBeenCalledTimes(1);
    expect(updateLoanMock.mock.calls[0][0]).toBe("owner-1");
    expect(updateLoanMock.mock.calls[0][1]).toBe("loan-1");
  });

  it("refuses an unknown loan and does not update", async () => {
    findLoanMock.mockResolvedValue(null);

    const result = await updateLoanAction({ ...validLoan, id: "foreign" });

    expect(result.status).toBe("invalid");
    expect(updateLoanMock).not.toHaveBeenCalled();
  });
});

describe("deleteLoanAction", () => {
  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(OWNER);
    deleteLoanMock.mockReset().mockResolvedValue(true);
    revalidatePathMock.mockReset();
  });

  it("deletes an owner-scoped loan", async () => {
    const result = await deleteLoanAction({ id: "loan-1" });

    expect(result.status).toBe("ok");
    expect(deleteLoanMock).toHaveBeenCalledWith("owner-1", "loan-1");
  });

  it("refuses an unknown loan and reports it", async () => {
    deleteLoanMock.mockResolvedValue(false);

    const result = await deleteLoanAction({ id: "loan-1" });

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/introuvable/i);
  });
});
