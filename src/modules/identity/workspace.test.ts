import { describe, expect, it } from "vitest";
import { type ActiveWorkspace, defaultWorkspaceId, resolveActiveWorkspace } from "./workspace";

/** Fictitious workspaces only, oldest first as `listMemberships` returns them. */
const personal: ActiveWorkspace = { id: "ws-user-1", name: "Personnel", kind: "PERSONAL", role: "OWNER", modules: ["budget"] };
const family: ActiveWorkspace = { id: "ws-family", name: "Famille", kind: "FAMILY", role: "VIEWER", modules: [] };

describe("resolveActiveWorkspace", () => {
  it("refuses a user without any membership", () => {
    expect(resolveActiveWorkspace([])).toBeNull();
    expect(resolveActiveWorkspace([], personal.id)).toBeNull();
  });

  it("defaults to the oldest membership, with the role it grants", () => {
    expect(resolveActiveWorkspace([personal, family])).toEqual(personal);
  });

  it("returns the requested workspace with the user's role there", () => {
    expect(resolveActiveWorkspace([personal, family], family.id)).toEqual(family);
  });

  it("reads a foreign workspace id as not found, without falling back", () => {
    // Falling back to the default would answer a request about another workspace
    // with this user's data: the caller must see "not found" instead.
    expect(resolveActiveWorkspace([personal, family], "ws-someone-else")).toBeNull();
  });
});

describe("defaultWorkspaceId", () => {
  it("derives from the user id, as the migration backfill does", () => {
    expect(defaultWorkspaceId("user-1")).toBe("ws-user-1");
  });
});
