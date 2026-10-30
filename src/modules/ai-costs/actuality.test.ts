import { describe, expect, it } from "vitest";
import {
  ACTUALITIES,
  ACTUALITY_DESCRIPTIONS,
  ACTUALITY_LABELS,
  assertActuality,
  InvalidActualityError,
  isActuality,
} from "./actuality";

describe("actuality", () => {
  it.each(ACTUALITIES)("accepts %s", (actuality) => {
    expect(isActuality(actuality)).toBe(true);
    expect(assertActuality(actuality)).toBe(actuality);
  });

  it("describes and labels every state", () => {
    for (const actuality of ACTUALITIES) {
      expect(ACTUALITY_LABELS[actuality]).not.toHaveLength(0);
      expect(ACTUALITY_DESCRIPTIONS[actuality]).not.toHaveLength(0);
    }
  });

  it("rejects an unknown state instead of guessing", () => {
    expect(isActuality("forecast")).toBe(false);
    expect(() => assertActuality("forecast")).toThrow(InvalidActualityError);
  });

  it("rejects case variants", () => {
    expect(() => assertActuality("OBSERVED")).toThrow(InvalidActualityError);
  });

  it("rejects a missing actuality", () => {
    expect(() => assertActuality(undefined)).toThrow(InvalidActualityError);
    expect(() => assertActuality(null)).toThrow(InvalidActualityError);
    expect(() => assertActuality("")).toThrow(InvalidActualityError);
  });
});
