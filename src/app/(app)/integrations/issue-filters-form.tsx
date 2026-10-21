"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FILTER_NONE, type IssueFilters } from "@/modules/integrations/issues";

/**
 * The explorer filters, submitted without a full page reload.
 *
 * A plain `<form method="get">` would reload the whole document on every submit: the
 * scroll jumps back to the top and the collapsible cards snap to their default. Here
 * the filter values are pushed through the router with `scroll: false`, so Next
 * re-renders the server components in place and the reader stays where they were —
 * a folded card stays folded, because its `open` prop never changes.
 */
export function IssueFiltersForm({
  filters,
  options,
}: {
  filters: IssueFilters;
  options: {
    repositories: string[];
    assignees: string[];
    labels: string[];
    milestones: string[];
    hasUnassigned: boolean;
    hasWithoutMilestone: boolean;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.query ?? "");

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string" && value.trim() !== "") {
        params.set(key, value);
      }
    }

    const queryString = params.toString();
    startTransition(() => {
      router.push(queryString ? `/integrations?${queryString}` : "/integrations", {
        scroll: false,
      });
    });
  }

  function reset(): void {
    setQuery("");
    startTransition(() => {
      router.push("/integrations", { scroll: false });
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <Select
        label="Dépôt"
        name="repo"
        value={filters.repository}
        allLabel="Tous"
        values={options.repositories}
      />

      <Select
        label="Type"
        name="kind"
        value={filters.kind}
        allLabel="Tous"
        values={["ISSUE", "PULL_REQUEST"]}
        labels={{ ISSUE: "Issues", PULL_REQUEST: "Pull requests" }}
      />

      <Select
        label="Assigné à"
        name="assignee"
        value={filters.assignee}
        allLabel="Tous"
        values={options.assignees}
        extra={options.hasUnassigned ? [{ value: FILTER_NONE, label: "Personne" }] : []}
      />

      <Select
        label="Étiquette"
        name="label"
        value={filters.label}
        allLabel="Toutes"
        values={options.labels}
      />

      <Select
        label="Jalon"
        name="milestone"
        value={filters.milestone}
        allLabel="Tous"
        values={options.milestones}
        extra={options.hasWithoutMilestone ? [{ value: FILTER_NONE, label: "Aucun" }] : []}
      />

      <Select
        label="État"
        name="flag"
        value={filters.flags?.[0]}
        allLabel="Tous"
        values={["unanswered", "recent", "stale", "unassigned"]}
        labels={{
          unanswered: `Sans réponse (≥ 3 j)`,
          recent: "Ouvertes récemment (14 j)",
          stale: "Anciennes (≥ 90 j)",
          unassigned: "Sans assigné",
        }}
      />

      <Select
        label="Tri"
        name="sort"
        value={filters.sort}
        allLabel="Plus récentes"
        values={["oldest", "comments", "activity"]}
        labels={{
          oldest: "Plus anciennes",
          comments: "Plus commentées",
          activity: "Activité récente",
        }}
      />

      <label className="flex flex-1 flex-col gap-1 text-sm">
        <span className="font-medium">Titre contient</span>
        <input
          type="search"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Filtrage..." : "Filtrer"}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Réinitialiser
        </button>
      </div>
    </form>
  );
}

/**
 * A filter control: a `<select>` plus its label, no client-side state.
 *
 * The empty option means "no constraint" and is always first, so clearing a filter is
 * one gesture from anywhere.
 */
function Select({
  label,
  name,
  value,
  allLabel,
  values,
  labels = {},
  extra = [],
}: {
  label: string;
  name: string;
  value: string | undefined;
  allLabel: string;
  values: string[];
  labels?: Record<string, string>;
  extra?: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ""}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
      >
        <option value="">{allLabel}</option>
        {values.map((option) => (
          <option key={option} value={option}>
            {labels[option] ?? option}
          </option>
        ))}
        {extra.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
