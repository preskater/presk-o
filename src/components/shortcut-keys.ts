/**
 * Global keyboard shortcuts (UX-02): `n` jumps to a new-transaction form, `/` to the
 * transaction search. Each targets the element carrying `data-shortcut="<target>"`; a
 * page without that element simply ignores the key.
 */
export type ShortcutTarget = "new-transaction" | "search";

type KeyEventLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
};

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function shortcutForKey(event: KeyEventLike): ShortcutTarget | null {
  // Never steal a key from someone typing, nor a browser or OS shortcut. Shift is allowed:
  // on an AZERTY keyboard `/` is Shift + `:`.
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.target?.isContentEditable) return null;
  if (event.target?.tagName && TYPING_TAGS.has(event.target.tagName.toUpperCase())) return null;

  if (event.key === "n" || event.key === "N") return "new-transaction";
  if (event.key === "/") return "search";
  return null;
}
