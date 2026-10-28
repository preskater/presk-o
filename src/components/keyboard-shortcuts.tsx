"use client";

import { useEffect } from "react";
import { SHORTCUT_FALLBACKS, shortcutForKey, type ShortcutTarget } from "./shortcut-keys";

/** The page's own target first, then the fallback when that element is absent. */
function findTarget(target: ShortcutTarget): HTMLElement | null {
  const direct = document.querySelector<HTMLElement>(`[data-shortcut="${target}"]`);
  if (direct) return direct;

  const fallback = SHORTCUT_FALLBACKS[target];
  return fallback
    ? document.querySelector<HTMLElement>(`[data-shortcut="${fallback}"]`)
    : null;
}

/**
 * Listens for the global shortcuts and moves the focus; it never submits anything. The
 * forms behind the targets keep their own validation and Server Actions.
 */
export function KeyboardShortcuts() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;

      const target = shortcutForKey({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        target: event.target instanceof HTMLElement ? event.target : null,
      });
      if (!target) return;

      const element = findTarget(target);
      if (!element) return;

      event.preventDefault();
      // The field may sit in a folded <details> (a collapsible card, "Nouvelle opération").
      for (let details = element.closest("details"); details; details = details.parentElement?.closest("details") ?? null) {
        details.open = true;
      }
      element.focus();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
