import { describe, expect, it } from "vitest";
import { readTableSort, sortHref } from "./table-sort";

const KEYS = ["subject", "age"] as const;
const FALLBACK = { key: "age", direction: "asc" } as const;

describe("readTableSort", () => {
  it("reads a known column and direction", () => {
    expect(readTableSort({ queueSort: "subject.desc" }, "queueSort", KEYS, FALLBACK)).toEqual({
      key: "subject",
      direction: "desc",
    });
  });

  it("falls back on an absent, unknown or malformed value", () => {
    for (const value of [undefined, "", "unknown.asc", "age.sideways", "age", ["age.desc", "age.asc"]]) {
      expect(readTableSort({ queueSort: value }, "queueSort", KEYS, FALLBACK)).toEqual(FALLBACK);
    }
  });
});

describe("sortHref", () => {
  it("flips the direction of the active column", () => {
    expect(sortHref("/x", {}, "s", { key: "age", direction: "asc" }, "age")).toBe("/x?s=age.desc");
    expect(sortHref("/x", {}, "s", { key: "age", direction: "desc" }, "age")).toBe("/x?s=age.asc");
  });

  it("starts another column ascending", () => {
    expect(sortHref("/x", {}, "s", { key: "age", direction: "desc" }, "subject")).toBe("/x?s=subject.asc");
  });

  it("keeps the other parameters and drops empty or repeated ones", () => {
    const href = sortHref(
      "/integrations",
      { repo: "acme/app", kind: "", label: ["a", "b"], activitySort: "activity.desc" },
      "queueSort",
      { key: "age", direction: "asc" },
      "subject",
    );

    expect(href).toBe("/integrations?repo=acme%2Fapp&activitySort=activity.desc&queueSort=subject.asc");
  });
});
