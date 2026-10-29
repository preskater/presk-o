import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guard";
import { formatInstant } from "@/lib/dates";
import type { CheckStatus } from "@/modules/diagnostics/checks";
import { runDiagnostics } from "@/modules/diagnostics/run";

// Read on every visit, never cached: the answer is about the system right now.
export const dynamic = "force-dynamic";

const STATUS: Record<CheckStatus, { label: string; tone: "positive" | "warning" | "negative" }> = {
  ok: { label: "OK", tone: "positive" },
  warning: { label: "Attention", tone: "warning" },
  error: { label: "Erreur", tone: "negative" },
};

/**
 * System diagnostics (SO-03), owner only.
 *
 * Read-only answers to operational questions — database, migrations, keys, providers,
 * backups, version — with what to do when something is wrong. No secret value is ever
 * shown: the checks report presence and validity, counts, names and dates only.
 */
export default async function DiagnosticsPage() {
  const user = await requireUser();
  const report = await runDiagnostics(user.id);

  return (
    <>
      <PageHeader
        title="Diagnostic"
        description={`État du système au ${formatInstant(new Date(report.generatedAt))}. Lecture seule : aucune valeur secrète n'est affichée.`}
      />

      {report.status !== "ok" ? (
        <Notice tone={report.status === "error" ? "error" : "warning"}>
          {report.status === "error"
            ? "Au moins une vérification est en erreur : suivez l'action indiquée."
            : "Tout fonctionne, mais au moins un point mérite votre attention."}
        </Notice>
      ) : null}

      <Card title="Vérifications">
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {report.checks.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS[entry.status].tone}>{STATUS[entry.status].label}</Badge>
                <span className="font-medium">{entry.label}</span>
              </div>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">{entry.message}</p>
              {entry.action ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">À faire : {entry.action}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
