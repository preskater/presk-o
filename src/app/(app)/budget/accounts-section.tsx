import Decimal from "decimal.js";
import Link from "next/link";
import { Badge, Card, EmptyState, Notice, tdClass, thClass } from "@/components/ui";
import { formatDateOnly, formatMonthLabel, monthRange, parseMonthKey } from "@/lib/dates";
import { formatMoney, type Currency } from "@/lib/money";
import { ACCOUNT_TYPE_LABELS } from "@/modules/budget/domain";
import { projectAccountBalance } from "@/modules/budget/projection";
import { sumPerCurrency } from "@/modules/budget/table-totals";
import {
  listAccountBalanceTotals,
  listAccountsForManagement,
  listCategoryUsage,
  listPendingOccurrenceAmounts,
} from "@/modules/budget/repository";
import { AccountsManager, type ManagedAccount } from "./accounts-manager";
import { CategoriesManager } from "./categories-manager";

/**
 * "Comptes" tab: balances, the projected end-of-month balance, and the management of
 * accounts and categories.
 *
 * The projection rule is the one documented in `src/modules/budget/projection.ts`:
 * recorded balance + the month's pending occurrences. For a past month, it reads as
 * "what was still to be processed" rather than a forecast — the card says so. An account
 * with no recorded transaction keeps an **unknown** balance and no projection: nothing
 * recorded is not zero. The simulated salary is deliberately absent from the projection
 * (no account owns it until it is booked) and the card says that too.
 */
export async function AccountsSection({
  workspaceId,
  monthKey,
}: {
  workspaceId: string;
  monthKey: string;
}) {
  const { year, month } = parseMonthKey(monthKey);
  const range = monthRange(year, month);
  const monthLabel = formatMonthLabel(year, month);

  const [accounts, balanceTotals, pendingOccurrences, categories] = await Promise.all([
    listAccountsForManagement(workspaceId),
    listAccountBalanceTotals(workspaceId),
    listPendingOccurrenceAmounts(workspaceId, { from: range.start, to: range.end }),
    listCategoryUsage(workspaceId),
  ]);

  const balanceByAccount = new Map(balanceTotals.map((total) => [total.accountId, total]));
  const pendingByAccount = new Map<
    string,
    { type: "INCOME" | "EXPENSE"; amount: Decimal }[]
  >();

  for (const occurrence of pendingOccurrences) {
    const list = pendingByAccount.get(occurrence.accountId) ?? [];
    list.push({ type: occurrence.type, amount: occurrence.amount });
    pendingByAccount.set(occurrence.accountId, list);
  }

  const rows = accounts.map((account) => {
    const recorded = balanceByAccount.get(account.id) ?? {
      transactionCount: 0,
      balance: new Decimal(0),
      lastOperationDate: null as Date | null,
    };
    const projection = projectAccountBalance({
      recorded,
      pending: pendingByAccount.get(account.id) ?? [],
    });

    return { account, recorded, projection };
  });
  // Footer totals, per currency (never across currencies). A balance that is unknown is
  // passed as `null`: the column then shows "—" instead of a total that would count it
  // as zero (see `sumPerCurrency`).
  const recordedTotals = sumPerCurrency(rows, ({ account, recorded }) => ({
    currency: account.currency,
    amount: recorded.transactionCount === 0 ? null : recorded.balance,
  }));
  const pendingTotals = sumPerCurrency(rows, ({ account, projection }) => ({
    currency: account.currency,
    amount: projection.pendingNet,
  }));
  const projectedTotals = sumPerCurrency(rows, ({ account, projection }) => ({
    currency: account.currency,
    amount: projection.kind === "KNOWN" ? projection.projected : null,
  }));
  // A threshold is a floor to keep, so the group's floor is the sum of the explicit ones;
  // an account left on "Automatique" has no figure to add and marks the column incomplete.
  const thresholdTotals = sumPerCurrency(rows, ({ account }) => ({
    currency: account.currency,
    amount: account.lowBalanceThreshold,
  }));

  // Per-currency counts and the most recent operation, the other two non-text columns.
  const groupInfo = new Map<
    Currency,
    { count: number; active: number; archived: number; lastOperation: Date | null }
  >();
  for (const { account, recorded } of rows) {
    const info = groupInfo.get(account.currency) ?? {
      count: 0,
      active: 0,
      archived: 0,
      lastOperation: null,
    };

    info.count += 1;
    if (account.archivedAt === null) {
      info.active += 1;
    } else {
      info.archived += 1;
    }
    if (
      recorded.lastOperationDate !== null &&
      (info.lastOperation === null ||
        recorded.lastOperationDate.getTime() > info.lastOperation.getTime())
    ) {
      info.lastOperation = recorded.lastOperationDate;
    }

    groupInfo.set(account.currency, info);
  }

  const managedAccounts: ManagedAccount[] = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    lowBalanceThreshold: account.lowBalanceThreshold?.toFixed(2) ?? null,
    archived: account.archivedAt !== null,
    transactionCount: balanceByAccount.get(account.id)?.transactionCount ?? 0,
  }));

  return (
    <>
      <Card
        title={`Soldes et projection — fin ${monthLabel}`}
        description="Solde enregistré : somme signée des opérations du compte. Seuil de solde bas : montant à conserver, défini dans la gestion des comptes ; « Automatique » utilise un mois de dépenses suggéré par la simulation. Solde projeté : solde enregistré + échéances du mois affiché encore en attente de décision. Le salaire simulé non enregistré n'est attribué à aucun compte : il reste dans Prévisions."
      >
        {rows.length === 0 ? (
          <EmptyState
            title="Aucun compte"
            description="Créez un compte dans l'onglet Opérations : c'est lui qui porte la devise des opérations."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-sm">
              <caption className="sr-only">Soldes par compte</caption>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>
                    Compte
                  </th>
                  <th scope="col" className={thClass}>
                    Type
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Solde enregistré
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Seuil de solde bas
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Échéances en attente
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Solde projeté
                  </th>
                  <th scope="col" className={thClass}>
                    Dernière opération
                  </th>
                  <th scope="col" className={thClass}>
                    État
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ account, recorded, projection }) => (
                  <tr key={account.id}>
                    <td className={tdClass}>{account.name}</td>
                    <td className={tdClass}>{ACCOUNT_TYPE_LABELS[account.type]}</td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {recorded.transactionCount === 0
                        ? "— (aucune opération)"
                        : formatMoney({ amount: recorded.balance, currency: account.currency })}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {account.lowBalanceThreshold === null ? (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          Automatique
                        </span>
                      ) : (
                        formatMoney({
                          amount: account.lowBalanceThreshold,
                          currency: account.currency,
                        })
                      )}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {projection.pendingCount === 0
                        ? "—"
                        : formatMoney({ amount: projection.pendingNet, currency: account.currency })}
                      {projection.pendingCount > 0 ? (
                        <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">
                          ({projection.pendingCount})
                        </span>
                      ) : null}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {projection.kind === "KNOWN" ? (
                        formatMoney({ amount: projection.projected, currency: account.currency })
                      ) : (
                        <span
                          className="text-xs text-zinc-500 dark:text-zinc-400"
                          title={projection.reason}
                        >
                          — solde de départ inconnu
                        </span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {recorded.lastOperationDate === null
                        ? "—"
                        : formatDateOnly(recorded.lastOperationDate)}
                    </td>
                    <td className={tdClass}>
                      {account.archivedAt === null ? (
                        <Badge>Actif</Badge>
                      ) : (
                        <Badge tone="warning">Archivé</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {[...recordedTotals.values()].map(({ currency, amount, complete }) => {
                  const pending = pendingTotals.get(currency);
                  const projected = projectedTotals.get(currency);
                  const threshold = thresholdTotals.get(currency);
                  const info = groupInfo.get(currency);

                  return (
                    <tr key={currency}>
                      <th scope="row" className={`${tdClass} text-right align-middle font-semibold`}>
                        Total ({currency})
                      </th>
                      <td className={`${tdClass} whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400`}>
                        {info?.count ?? 0} compte{(info?.count ?? 0) > 1 ? "s" : ""}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-right font-semibold tabular-nums`}>
                        {complete ? (
                          formatMoney({ amount, currency })
                        ) : (
                          <span title="Au moins un compte sans opération : le total serait incomplet.">
                            —
                          </span>
                        )}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-right font-semibold tabular-nums`}>
                        {threshold?.complete ? (
                          formatMoney({ amount: threshold.amount, currency })
                        ) : (
                          <span title="Au moins un compte a un seuil automatique : le total serait incomplet.">
                            —
                          </span>
                        )}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-right font-semibold tabular-nums`}>
                        {pending ? formatMoney({ amount: pending.amount, currency }) : "—"}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-right font-semibold tabular-nums`}>
                        {projected?.complete ? (
                          formatMoney({ amount: projected.amount, currency })
                        ) : (
                          <span title="Au moins un compte a un solde projeté inconnu.">—</span>
                        )}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap font-semibold`}>
                        {info?.lastOperation ? (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {formatDateOnly(info.lastOperation)}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">—</span>
                        )}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400`}>
                        {info?.active ?? 0} actif{(info?.active ?? 0) > 1 ? "s" : ""}
                        {info && info.archived > 0
                          ? ` · ${info.archived} archivé${info.archived > 1 ? "s" : ""}`
                          : ""}
                      </td>
                    </tr>
                  );
                })}
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Gérer les comptes"
        description="Renommer, changer le type, définir le seuil de solde bas, archiver ou réactiver. Le seuil du compte est prioritaire ; à défaut, la règle globale s'applique si elle est au moins égale à la suggestion, sinon la simulation suggère un mois de dépenses. Un compte porteur d'opérations garde sa devise : rien n'est converti. L'archivage retire le compte des formulaires et des alertes sans toucher à son historique."
      >
        {managedAccounts.length === 0 ? (
          <Notice tone="info">Aucun compte à gérer pour l&apos;instant.</Notice>
        ) : (
          <AccountsManager accounts={managedAccounts} />
        )}
      </Card>

      <Card
        title="Catégories"
        description="Renommer, fusionner ou supprimer. La fusion déplace opérations, séries et budgets vers la catégorie cible et indique combien de budgets en doublon ont été supprimés ; la suppression détache les opérations et les séries récurrentes (les montants restent) et supprime les budgets de la catégorie."
        actions={
          <Link
            href="/budget?tab=operations"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Créer une catégorie
          </Link>
        }
      >
        <CategoriesManager categories={categories} />
      </Card>
    </>
  );
}
