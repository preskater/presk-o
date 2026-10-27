"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setModuleEnabledAction } from "./actions";

/** Enables or disables one module. The action decides on its own: this is a comfort, not a guard. */
export function ModuleToggle({
  moduleKey,
  label,
  enabled,
}: {
  moduleKey: string;
  label: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(): void {
    if (enabled && !window.confirm(`Désactiver le module « ${label} » ? Ses données sont conservées.`)) {
      return;
    }

    startTransition(async () => {
      const outcome = await setModuleEnabledAction({ key: moduleKey, enabled: !enabled });

      if (outcome.status === "ok") {
        setError(null);
        router.refresh();
        return;
      }

      setError(outcome.message);
    });
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {pending ? "…" : enabled ? "Désactiver" : "Activer"}
      </button>
      {error ? (
        <span className="text-xs text-rose-700 dark:text-rose-400" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
