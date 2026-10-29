import { describe, expect, it } from "vitest";
import { SHORTCUT_FALLBACKS, shortcutForKey } from "./shortcut-keys";

const page = { tagName: "BODY" };
const noModifiers = { ctrlKey: false, metaKey: false, altKey: false };

describe("shortcutForKey", () => {
  it("maps n and / outside a field", () => {
    expect(shortcutForKey({ ...noModifiers, key: "n", target: page })).toBe("new-transaction");
    expect(shortcutForKey({ ...noModifiers, key: "N", target: page })).toBe("new-transaction");
    expect(shortcutForKey({ ...noModifiers, key: "/", target: page })).toBe("search");
  });

  it("ignores keys typed into a field", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) {
      expect(shortcutForKey({ ...noModifiers, key: "n", target: { tagName } })).toBeNull();
    }
    expect(
      shortcutForKey({ ...noModifiers, key: "/", target: { tagName: "DIV", isContentEditable: true } }),
    ).toBeNull();
  });

  it("leaves browser and OS combinations alone", () => {
    expect(shortcutForKey({ ...noModifiers, ctrlKey: true, key: "n", target: page })).toBeNull();
    expect(shortcutForKey({ ...noModifiers, metaKey: true, key: "n", target: page })).toBeNull();
    expect(shortcutForKey({ ...noModifiers, altKey: true, key: "/", target: page })).toBeNull();
  });

  it("ignores other keys and a missing target is not a field", () => {
    expect(shortcutForKey({ ...noModifiers, key: "x", target: page })).toBeNull();
    expect(shortcutForKey({ ...noModifiers, key: "/", target: null })).toBe("search");
  });

  it("reaches the global search when a page has no local one", () => {
    // `/` still prefers the budget's filter; the header's field is the fallback.
    expect(SHORTCUT_FALLBACKS.search).toBe("global-search");
    expect(SHORTCUT_FALLBACKS["new-transaction"]).toBeUndefined();
  });
});
