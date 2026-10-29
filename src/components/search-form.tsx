import { inputClass } from "@/components/ui";

/**
 * The single search entry point (UX-01).
 *
 * A plain GET form: it works without JavaScript, submits with Enter from the field, and
 * the resulting page is a normal server render. The header passes `shortcut` so `/`
 * focuses this field on every page (the budget's own label search keeps priority there).
 */
export function SearchForm({
  id,
  defaultValue = "",
  className = "",
  shortcut = false,
}: {
  /** Explicit, because the header and the search page may both render the form. */
  id: string;
  defaultValue?: string;
  className?: string;
  shortcut?: boolean;
}) {
  return (
    <form
      action="/search"
      method="get"
      role="search"
      aria-label="Recherche globale"
      className={`flex items-center gap-2 ${className}`}
    >
      <label htmlFor={id} className="sr-only">
        Rechercher dans vos données
      </label>
      <input
        id={id}
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder="Rechercher…"
        autoComplete="off"
        enterKeyHint="search"
        data-shortcut={shortcut ? "global-search" : undefined}
        className={inputClass}
      />
      <button
        type="submit"
        className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Chercher
      </button>
    </form>
  );
}
