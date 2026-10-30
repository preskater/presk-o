import { describe, expect, it } from "vitest";
import {
  capturedAtInstant,
  createCostSource,
  InvalidCostSourceError,
  UnsafeSourceReferenceError,
} from "./source";

const NOW = new Date("2026-10-28T12:00:00.000Z");

describe("createCostSource", () => {
  it("captures a provider reference in UTC", () => {
    const source = createCostSource({
      kind: "provider",
      provider: "openai",
      externalId: "inv-2026-10",
      capturedAt: "2026-10-28T16:00:00+04:00",
    });

    expect(source).toEqual({
      kind: "provider",
      provider: "openai",
      externalId: "inv-2026-10",
      capturedAt: "2026-10-28T12:00:00.000Z",
    });
  });

  it("captures an import row", () => {
    const source = createCostSource({
      kind: "import",
      importId: "import-42",
      rowNumber: 3,
      capturedAt: NOW,
    });

    expect(source).toMatchObject({
      kind: "import",
      importId: "import-42",
      rowNumber: 3,
      capturedAt: NOW.toISOString(),
    });
  });

  it("captures a manual entry with its author", () => {
    const source = createCostSource({
      kind: "manual",
      enteredBy: "user-1",
      capturedAt: NOW,
    });

    expect(source).toMatchObject({ kind: "manual", enteredBy: "user-1" });
  });

  it("defaults the capture instant to the injected clock", () => {
    const source = createCostSource(
      { kind: "manual", enteredBy: "user-1" },
      { now: NOW },
    );

    expect(source.capturedAt).toBe(NOW.toISOString());
  });

  it("does not keep a reference to the caller's mutable Date", () => {
    const capturedAt = new Date(NOW);
    const source = createCostSource({
      kind: "manual",
      enteredBy: "user-1",
      capturedAt,
    });

    capturedAt.setUTCFullYear(2030);

    expect(source.capturedAt).toBe(NOW.toISOString());
  });

  it("returns a fresh Date from capturedAtInstant", () => {
    const source = createCostSource({
      kind: "manual",
      enteredBy: "user-1",
      capturedAt: NOW,
    });

    const instant = capturedAtInstant(source);
    instant.setUTCFullYear(2030);

    expect(source.capturedAt).toBe(NOW.toISOString());
  });

  it("is frozen: its creation timestamp cannot be rewritten", () => {
    const source = createCostSource({
      kind: "manual",
      enteredBy: "user-1",
      capturedAt: NOW,
    });

    expect(Object.isFrozen(source)).toBe(true);
    expect(() => Object.assign(source, { capturedAt: "2030-01-01T00:00:00.000Z" })).toThrow(
      TypeError,
    );
    expect(source.capturedAt).toBe(NOW.toISOString());
  });

  it("requires an explicit time zone on a captured instant", () => {
    expect(() =>
      createCostSource({
        kind: "manual",
        enteredBy: "user-1",
        capturedAt: "2026-10-28T12:00:00",
      }),
    ).toThrow(InvalidCostSourceError);

    expect(() =>
      createCostSource({
        kind: "manual",
        enteredBy: "user-1",
        capturedAt: "2026-10-28",
      }),
    ).toThrow(InvalidCostSourceError);
  });

  it("refuses an invalid row number", () => {
    for (const rowNumber of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        createCostSource({
          kind: "import",
          importId: "import-42",
          rowNumber,
        }),
      ).toThrow(InvalidCostSourceError);
    }
  });

  it("refuses an unknown source kind", () => {
    expect(() =>
      createCostSource({ kind: "spreadsheet" } as never),
    ).toThrow(InvalidCostSourceError);
  });

  it("refuses a non-lowercase provider identifier", () => {
    expect(() =>
      createCostSource({
        kind: "provider",
        provider: "OpenAI",
        externalId: "inv-1",
      }),
    ).toThrow(InvalidCostSourceError);
  });

  it("refuses token-shaped identifiers", () => {
    const tokens = [
      "sk-live-1234567890abcdef",
      "ghp_1234567890abcdef",
      "glpat-1234567890abcdef",
      "Bearer abcdefghijklmnop",
      "api_key=abcdefghijklmnop",
    ];

    for (const externalId of tokens) {
      expect(() =>
        createCostSource({
          kind: "provider",
          provider: "openai",
          externalId,
        }),
      ).toThrow(UnsafeSourceReferenceError);
    }
  });

  it("never echoes the rejected value in the error message", () => {
    const token = "sk-live-1234567890abcdef";

    try {
      createCostSource({
        kind: "provider",
        provider: "openai",
        externalId: token,
      });
      expect.unreachable("the token-shaped identifier must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafeSourceReferenceError);
      expect((error as Error).message).not.toContain(token);
    }
  });
});
