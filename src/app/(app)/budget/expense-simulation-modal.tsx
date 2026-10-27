"use client";

import Decimal from "decimal.js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Badge,
  Field,
  Notice,
  StatCard,
  TableShell,
  inputClass,
  submitClass,
  tdClass,
  thClass,
} from "@/components/ui";
import { formatDateOnly, formatMonthLabel, parseMonthKey } from "@/lib/dates";
import {
  formatMoney,
  parseAmountInput,
  SUPPORTED_CURRENCIES,
  type Currency,
} from "@/lib/money";
import type { AccountSummary, CategorySummary } from "@/modules/budget/domain";
import type {
  SerializedSimulationResult,
} from "@/modules/budget/simulation-contract";
import {
  simulateExpenseAction,
  type ExpenseSimulationActionResult,
} from "./actions";

type DraftPayment = {
  accountId: string;
  amount: string;
  operationDate: string;
};

type Stage = "form" | "summary";

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyPayment(accountId = ""): DraftPayment {
  return { accountId, amount: "", operationDate: todayDateInput() };
}

function monthLabel(key: string): string {
  const { year, month } = parseMonthKey(key);
  return formatMonthLabel(year, month);
}

type FloorSource = SerializedSimulationResult["accounts"][number]["floorSource"];

function money(value: string | null, currency: Currency, empty = "—"): string {
  return value === null
    ? empty
    : formatMoney({ amount: new Decimal(value), currency });
}

function floorSourceLabel(source: FloorSource): string {
  if (source === "ACCOUNT") {
    return "Seuil configuré";
  }
  if (source === "GLOBAL") {
    return "Règle globale";
  }
  if (source === "SUGGESTED") {
    return "Seuil suggéré (1 mois de dépenses)";
  }
  return "Aucun seuil";
}

function dateLabel(value: string): string {
  return formatDateOnly(new Date(`${value}T00:00:00.000Z`));
}

function fieldError(
  result: ExpenseSimulationActionResult | null,
  path: string,
): string | undefined {
  if (!result || result.status !== "invalid") {
    return undefined;
  }

  return (
    result.fieldErrors[path]?.[0] ??
    Object.entries(result.fieldErrors).find(([key]) => key.startsWith(`${path}.`))?.[1][0]
  );
}

/**
 * "Simuler une dépense": a read-only scenario.
 *
 * The first dialog collects the payments. The result is then shown as a summary,
 * with a second dialog for the full analysis: month-by-month balances, account
 * projections, each payment's before/after, the threshold and the budget impact.
 * Nothing here writes a transaction.
 */
export function ExpenseSimulationModal({
  accounts,
  categories,
  defaultCurrency,
}: {
  accounts: AccountSummary[];
  categories: CategorySummary[];
  defaultCurrency: Currency;
}) {
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("form");
  const [label, setLabel] = useState("");
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [categoryId, setCategoryId] = useState("");
  const [payments, setPayments] = useState<DraftPayment[]>([
    emptyPayment(accounts[0]?.id ?? ""),
  ]);
  const [result, setResult] = useState<ExpenseSimulationActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const currencyAccounts = accounts.filter((account) => account.currency === currency);
  const simulation = result?.status === "ok" ? result.simulation : null;
  const computedTotal = computeDraftTotal(payments);

  useEffect(() => {
    if (!open && !detailOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      if (detailOpen) {
        setDetailOpen(false);
      } else {
        closeAll();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, detailOpen]);

  useEffect(() => {
    if (open && !detailOpen) {
      dialogRef.current?.focus();
    }
  }, [open, detailOpen]);

  useEffect(() => {
    if (detailOpen) {
      detailRef.current?.focus();
    }
  }, [detailOpen]);

  function closeAll() {
    setOpen(false);
    setDetailOpen(false);
    setStage("form");
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function openModal() {
    setOpen(true);
    setStage("form");
  }

  function changeCurrency(next: Currency) {
    setCurrency(next);
    setPayments((current) =>
      current.map((payment) => {
        const account = accounts.find((entry) => entry.id === payment.accountId);
        return account && account.currency !== next
          ? { ...payment, accountId: "" }
          : payment;
      }),
    );
  }

  function updatePayment(index: number, patch: Partial<DraftPayment>) {
    setPayments((current) =>
      current.map((payment, position) =>
        position === index ? { ...payment, ...patch } : payment,
      ),
    );
  }

  function addPayment() {
    setPayments((current) => [...current, emptyPayment(currencyAccounts[0]?.id ?? "")]);
  }

  function removePayment(index: number) {
    setPayments((current) => current.filter((_, position) => position !== index));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult(null);

    try {
      const outcome = await simulateExpenseAction({
        label,
        currency,
        categoryId: categoryId === "" ? null : categoryId,
        payments,
      });
      setResult(outcome);
      if (outcome.status === "ok") {
        setStage("summary");
      }
    } catch {
      setResult({
        status: "error",
        message: "La simulation n'a pas pu être calculée. Réessayez dans un instant.",
      });
    } finally {
      setPending(false);
    }
  }

  const formError =
    result && result.status !== "ok" ? result.message : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openModal}
        aria-haspopup="dialog"
        className={submitClass}
      >
        Simuler une dépense
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeAll();
            }
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="expense-simulation-title"
            aria-describedby="expense-simulation-description"
            aria-hidden={detailOpen || undefined}
            inert={detailOpen || undefined}
            tabIndex={-1}
            className="mx-auto my-6 w-full max-w-3xl rounded-lg border border-zinc-200 bg-white shadow-xl outline-none dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 p-5 dark:border-zinc-800">
              <div>
                <h2 id="expense-simulation-title" className="text-lg font-semibold">
                  {stage === "summary" ? "Résultat de la simulation" : "Simuler une dépense"}
                </h2>
                <p
                  id="expense-simulation-description"
                  className="mt-1 text-sm text-zinc-600 dark:text-zinc-400"
                >
                  Scénario non enregistré : aucune transaction n&apos;est créée.
                </p>
              </div>
              <button
                type="button"
                onClick={closeAll}
                className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                aria-label="Fermer la simulation"
              >
                Fermer
              </button>
            </div>

            <div className="p-5">
              {stage === "form" || !simulation ? (
                <SimulationForm
                  label={label}
                  setLabel={setLabel}
                  currency={currency}
                  changeCurrency={changeCurrency}
                  categoryId={categoryId}
                  setCategoryId={setCategoryId}
                  categories={categories}
                  currencyAccounts={currencyAccounts}
                  payments={payments}
                  updatePayment={updatePayment}
                  addPayment={addPayment}
                  removePayment={removePayment}
                  computedTotal={computedTotal}
                  pending={pending}
                  formError={formError}
                  result={result}
                  submit={submit}
                />
              ) : (
                <SimulationSummary
                  simulation={simulation}
                  label={label}
                  onModify={() => setStage("form")}
                  onOpenDetail={() => setDetailOpen(true)}
                  onClose={closeAll}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {detailOpen && simulation ? (
        <div
          className="fixed inset-0 z-[60] overflow-y-auto bg-zinc-950/60 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDetailOpen(false);
            }
          }}
        >
          <div
            ref={detailRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="expense-simulation-detail-title"
            tabIndex={-1}
            className="mx-auto my-6 w-full max-w-6xl rounded-lg border border-zinc-200 bg-white shadow-2xl outline-none dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 p-5 dark:border-zinc-800">
              <div>
                <h2 id="expense-simulation-detail-title" className="text-lg font-semibold">
                  Analyse complète — {label.trim() === "" ? "dépense simulée" : label}
                </h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {monthLabel(simulation.horizon.startKey)} →{" "}
                  {monthLabel(simulation.horizon.endKey)} ·{" "}
                  {money(simulation.totalAmount, simulation.currency)} ·{" "}
                  {simulation.payments.length} paiement
                  {simulation.payments.length > 1 ? "s" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailOpen(false)}
                className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Revenir au résumé
              </button>
            </div>

            <div className="space-y-8 p-5">
              <DetailContent simulation={simulation} />
              <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setDetailOpen(false)}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Revenir au résumé
                </button>
                <button type="button" onClick={closeAll} className={submitClass}>
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function computeDraftTotal(payments: readonly DraftPayment[]): Decimal | null {
  let total = new Decimal(0);

  for (const payment of payments) {
    if (payment.amount.trim() === "") {
      return null;
    }
    try {
      total = total.plus(parseAmountInput(payment.amount));
    } catch {
      return null;
    }
  }

  return total;
}

function SimulationForm({
  label,
  setLabel,
  currency,
  changeCurrency,
  categoryId,
  setCategoryId,
  categories,
  currencyAccounts,
  payments,
  updatePayment,
  addPayment,
  removePayment,
  computedTotal,
  pending,
  formError,
  result,
  submit,
}: {
  label: string;
  setLabel: (value: string) => void;
  currency: Currency;
  changeCurrency: (value: Currency) => void;
  categoryId: string;
  setCategoryId: (value: string) => void;
  categories: CategorySummary[];
  currencyAccounts: AccountSummary[];
  payments: DraftPayment[];
  updatePayment: (index: number, patch: Partial<DraftPayment>) => void;
  addPayment: () => void;
  removePayment: (index: number) => void;
  computedTotal: Decimal | null;
  pending: boolean;
  formError: string | null;
  result: ExpenseSimulationActionResult | null;
  submit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const completePayments = payments.every(
    (payment) =>
      payment.amount.trim() !== "" && payment.operationDate !== "",
  );
  const canSubmit =
    !pending &&
    currencyAccounts.length > 0 &&
    completePayments &&
    computedTotal !== null &&
    computedTotal.greaterThan(0);

  return (
    <form onSubmit={submit} className="space-y-5" noValidate aria-busy={pending}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field
            label="Libellé (facultatif)"
            htmlFor="simulation-label"
            error={fieldError(result, "label")}
            hint="Sert uniquement à nommer ce scénario à l'écran."
          >
            <input
              id="simulation-label"
              className={inputClass}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              autoComplete="off"
              maxLength={200}
              placeholder="Ex. Achat d'un ordinateur"
            />
          </Field>
        </div>

        <Field
          label="Devise"
          htmlFor="simulation-currency"
          error={fieldError(result, "currency")}
        >
          <select
            id="simulation-currency"
            className={inputClass}
            value={currency}
            onChange={(event) => changeCurrency(event.target.value as Currency)}
          >
            {SUPPORTED_CURRENCIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Catégorie (facultatif)"
          htmlFor="simulation-category"
          error={fieldError(result, "categoryId")}
          hint="Permet d'afficher l'impact sur l'enveloppe budgétaire du mois."
        >
          <select
            id="simulation-category"
            className={inputClass}
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Aucune catégorie</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <section className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <h3 className="text-sm font-semibold">Paiements</h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Un seul paiement ou plusieurs échéances. Sans compte choisi,
              l&apos;application propose une répartition.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Total calculé
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {computedTotal === null
                ? "—"
                : formatMoney({ amount: computedTotal, currency })}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {payments.length} paiement{payments.length > 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <div className="space-y-3 p-4">
          {payments.map((payment, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-md border border-zinc-200 p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] dark:border-zinc-800"
            >
              <Field
                label={`Compte ${index + 1} (facultatif)`}
                htmlFor={`payment-${index}-account`}
                error={fieldError(result, `payments.${index}.accountId`)}
              >
                <select
                  id={`payment-${index}-account`}
                  className={inputClass}
                  value={payment.accountId}
                  onChange={(event) =>
                    updatePayment(index, { accountId: event.target.value })
                  }
                >
                  <option value="">Répartition automatique (suggérée)</option>
                  {currencyAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Montant"
                htmlFor={`payment-${index}-amount`}
                error={fieldError(result, `payments.${index}.amount`)}
              >
                <input
                  id={`payment-${index}-amount`}
                  className={inputClass}
                  inputMode="decimal"
                  value={payment.amount}
                  onChange={(event) =>
                    updatePayment(index, { amount: event.target.value })
                  }
                  placeholder="0,00"
                  required
                />
              </Field>

              <Field
                label="Date"
                htmlFor={`payment-${index}-date`}
                error={fieldError(result, `payments.${index}.operationDate`)}
              >
                <input
                  id={`payment-${index}-date`}
                  type="date"
                  className={inputClass}
                  value={payment.operationDate}
                  onChange={(event) =>
                    updatePayment(index, { operationDate: event.target.value })
                  }
                  required
                />
              </Field>

              <div className="flex items-end">
                {payments.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removePayment(index)}
                    className="rounded-md px-2 py-1.5 text-sm text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
                    aria-label={`Retirer le paiement ${index + 1}`}
                  >
                    Retirer
                  </button>
                ) : null}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={addPayment}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Ajouter un paiement
            </button>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Le total est la somme des paiements : il n&apos;y a pas de montant
              séparé à saisir.
            </p>
          </div>
        </div>
      </section>

      {currencyAccounts.length === 0 ? (
        <Notice tone="warning">
          Aucun compte actif n&apos;est disponible dans cette devise. Créez-en un dans
          l&apos;onglet Comptes ou choisissez une autre devise.
        </Notice>
      ) : null}

      {formError ? <Notice tone="error">{formError}</Notice> : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={`${submitClass} disabled:cursor-not-allowed`}
        >
          {pending ? "Calcul…" : "Analyser l'impact"}
        </button>
      </div>
    </form>
  );
}

function SimulationSummary({
  simulation,
  label,
  onModify,
  onOpenDetail,
  onClose,
}: {
  simulation: SerializedSimulationResult;
  label: string;
  onModify: () => void;
  onOpenDetail: () => void;
  onClose: () => void;
}) {
  const { summary } = simulation;
  const breach = summary.firstThresholdBreach;
  const hasAnyFloor = summary.thresholds.noneCount < summary.thresholds.accountCount;
  const currentMonthLabel = monthLabel(summary.currentMonthKey);
  const impactedAccounts = simulation.accounts.filter((account) =>
    new Decimal(account.paymentsTotal).greaterThan(0),
  ).length;

  return (
    <div className="space-y-5" aria-live="polite">
      <VerdictBanner simulation={simulation} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Dépense simulée"
          value={money(simulation.totalAmount, simulation.currency)}
          hint={`${simulation.payments.length} paiement${
            simulation.payments.length > 1 ? "s" : ""
          } · horizon ${simulation.months.length} mois`}
        />
        <StatCard
          label="Solde enregistré"
          value={money(summary.recordedBalance, simulation.currency, "Données indisponibles")}
          hint="Somme signée des opérations enregistrées, hors prévisions non confirmées."
        />
        <StatCard
          label={`Fin de mois — ${currentMonthLabel}`}
          value={money(summary.currentMonthEndAfter, simulation.currency, "Données indisponibles")}
          tone={
            summary.currentMonthEndAfter !== null &&
            new Decimal(summary.currentMonthEndAfter).isNegative()
              ? "negative"
              : "neutral"
          }
          hint={`Sans simulation : ${money(
            summary.currentMonthEndBefore,
            simulation.currency,
            "inconnu",
          )} · impact du mois : ${money(
            summary.currentMonthDelta,
            simulation.currency,
          )}`}
        />
        <StatCard
          label="Point bas global projeté"
          value={money(summary.lowestProjected, simulation.currency, "Données indisponibles")}
          tone={breach ? "warning" : "neutral"}
          hint={
            summary.lowestProjectedMonth
              ? `${monthLabel(summary.lowestProjectedMonth)}${
                  summary.lowestAccount
                    ? ` · compte le plus bas : ${summary.lowestAccount.accountName}`
                    : ""
                }`
              : "Aucun mois projeté"
          }
        />
        <StatCard
          label="Seuils de sécurité"
          value={hasAnyFloor ? "Par compte" : "Aucun seuil"}
          tone={breach ? "warning" : "neutral"}
          hint={`${summary.thresholds.configuredCount} configuré${
            summary.thresholds.configuredCount > 1 ? "s" : ""
          } · ${summary.thresholds.suggestedCount} suggéré${
            summary.thresholds.suggestedCount > 1 ? "s" : ""
          } · ${summary.thresholds.globalCount} règle globale · ${
            summary.thresholds.noneCount
          } sans seuil · modifiables dans Comptes`}
        />
        <StatCard
          label="Comptes et paiements"
          value={`${impactedAccounts} compte${impactedAccounts > 1 ? "s" : ""}`}
          hint={`${simulation.payments.length} paiement${
            simulation.payments.length > 1 ? "s" : ""
          } · ${simulation.months.length} mois projetés`}
        />
      </div>

      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Détail des paiements</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {label.trim() === "" ? "Scénario sans libellé" : label}
            </p>
          </div>
          {breach ? (
            <Badge tone="warning">
              Seuil franchi : {breach.accountName}
            </Badge>
          ) : (
            <Badge tone="positive">Aucun franchissement</Badge>
          )}
        </div>

        <TableShell caption="Détail des paiements simulés">
          <thead>
            <tr>
              <th scope="col" className={thClass}>
                Date
              </th>
              <th scope="col" className={thClass}>
                Compte
              </th>
              <th scope="col" className={`${thClass} text-right`}>
                Montant
              </th>
              <th scope="col" className={`${thClass} text-right`}>
                Cumul compte
              </th>
              <th scope="col" className={`${thClass} text-right`}>
                Solde après
              </th>
              <th scope="col" className={thClass}>
                Seuil
              </th>
            </tr>
          </thead>
          <tbody>
            {simulation.payments.map((payment) => (
              <tr key={`${payment.index}-${payment.operationDate}`}>
                <td className={`${tdClass} whitespace-nowrap`}>
                  {dateLabel(payment.operationDate)}
                </td>
                <td className={tdClass}>
                  {payment.accountId === null ? (
                    <>
                      <span className="font-medium">Répartition suggérée</span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {payment.allocations.length === 0
                          ? "Aucun compte disponible"
                          : `${payment.allocations.length} compte${
                              payment.allocations.length > 1 ? "s" : ""
                            }`}
                      </span>
                    </>
                  ) : (
                    payment.accountName
                  )}
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                  {money(payment.amount, simulation.currency)}
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                  {payment.accountId === null
                    ? "—"
                    : money(payment.accountCumulative, simulation.currency)}
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                  {payment.accountId === null
                    ? "—"
                    : money(payment.balanceAfter, simulation.currency, "Inconnu")}
                </td>
                <td className={tdClass}>
                  {payment.thresholdBreached === null ? (
                    "—"
                  ) : payment.thresholdBreached ? (
                    <Badge tone="warning">
                      {payment.thresholdCausedByScenario ? "Franchi ici" : "Franchi"}
                    </Badge>
                  ) : (
                    <Badge tone="positive">OK</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </section>

      <SuggestedAllocations simulation={simulation} />

      <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <button
          type="button"
          onClick={onModify}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Modifier le scénario
        </button>
        <button type="button" onClick={onOpenDetail} className={submitClass}>
          Voir l&apos;analyse complète
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}

function VerdictBanner({ simulation }: { simulation: SerializedSimulationResult }) {
  const { summary } = simulation;

  if (summary.verdict === "breach") {
    if (summary.firstThresholdBreach) {
      const breach = summary.firstThresholdBreach;
      return (
        <Notice tone="warning">
          <strong>
            {breach.causedByScenario
              ? "Ce scénario franchit le seuil de solde bas."
              : "Le seuil de solde bas est franchi même sans ce scénario."}
          </strong>{" "}
          Solde projeté : {money(breach.amount, simulation.currency)} sur «{" "}
          {breach.accountName} » en {monthLabel(breach.monthKey)}.{" "}
          {floorSourceLabel(breach.floorSource)} :{" "}
          {money(breach.floor, simulation.currency)}.
        </Notice>
      );
    }

    if (summary.globalNegativeMonth) {
      return (
        <Notice tone="warning">
          <strong>Le solde global devient négatif.</strong> Le premier mois concerné
          est {monthLabel(summary.globalNegativeMonth)}.
        </Notice>
      );
    }

    const negativeAccounts = simulation.accounts.filter(
      (account) =>
        account.lowestAfter !== null &&
        new Decimal(account.lowestAfter).lessThan(0),
    );
    return (
      <Notice tone="warning">
        <strong>Au moins un compte devient négatif sur l&apos;horizon.</strong>{" "}
        {negativeAccounts.map((account) => account.name).join(", ")}. Consultez le
        détail par compte, même si le total global reste positif.
      </Notice>
    );
  }

  if (summary.verdict === "unknown") {
    return (
      <Notice tone="info">
        Le solde de départ est inconnu : aucune projection chiffrée fiable ne peut être
        affichée. Le détail reste visible, mais les comptes sans opération ne sont pas
        assimilés à zéro.
      </Notice>
    );
  }

  return (
    <Notice tone="info">
      <strong>Le scénario reste au-dessus du seuil.</strong> Les projections incluent
      les opérations enregistrées, les échéances en attente et le salaire simulé. Aucune
      devise n&apos;est convertie.
    </Notice>
  );
}

function DetailContent({ simulation }: { simulation: SerializedSimulationResult }) {
  const { summary } = simulation;

  return (
    <>
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Impact mois par mois
            </h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Solde de fin de mois avec les opérations enregistrées, les échéances en
              attente et le salaire simulé, puis avec la dépense.
            </p>
          </div>
          {simulation.horizon.capped ? (
            <Badge tone="warning">Horizon limité à 24 mois</Badge>
          ) : null}
        </div>

        <TableShell caption="Projection mensuelle du scénario">
          <thead>
            <tr>
              <th scope="col" className={thClass}>
                Mois
              </th>
              <th scope="col" className={`${thClass} text-right`}>
                Net enregistré
              </th>
              <th scope="col" className={`${thClass} text-right`}>
                Recettes prévues
              </th>
              <th scope="col" className={`${thClass} text-right`}>
                Dépenses prévues
              </th>
              <th scope="col" className={`${thClass} text-right`}>
                Net prévisionnel
              </th>
              <th scope="col" className={`${thClass} text-right`}>
                Solde sans simulation
              </th>
              <th scope="col" className={`${thClass} text-right`}>
                Dépense simulée
              </th>
              <th scope="col" className={`${thClass} text-right`}>
                Solde avec simulation
              </th>
              <th scope="col" className={thClass}>
                Seuil
              </th>
            </tr>
          </thead>
          <tbody>
            {simulation.months.map((month) => (
              <tr
                key={month.key}
                className={
                  month.key === summary.currentMonthKey
                    ? "bg-zinc-50 dark:bg-zinc-800/50"
                    : undefined
                }
              >
                <td className={`${tdClass} whitespace-nowrap font-medium`}>
                  {month.label}
                  {month.key === summary.currentMonthKey ? (
                    <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                      mois en cours
                    </span>
                  ) : null}
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                  {month.recordedCount === 0
                    ? "—"
                    : money(month.recordedNet, simulation.currency)}
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                  {month.forecastCount === 0
                    ? "—"
                    : money(month.forecastIncome, simulation.currency)}
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                  {month.forecastCount === 0
                    ? "—"
                    : money(month.forecastExpense, simulation.currency)}
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                  {month.forecastCount === 0
                    ? "—"
                    : money(month.forecastNet, simulation.currency)}
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                  {money(month.balanceBeforeScenario, simulation.currency, "Données indisponibles")}
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                  {money(month.simulatedExpense, simulation.currency)}
                </td>
                <td
                  className={`${tdClass} whitespace-nowrap text-right tabular-nums font-medium ${
                    month.globalNegative
                      ? "text-rose-700 dark:text-rose-400"
                      : ""
                  }`}
                >
                  {money(month.balanceAfterScenario, simulation.currency, "Données indisponibles")}
                </td>
                <td className={tdClass}>
                  {month.thresholdBreachCount > 0 ? (
                    <Badge tone="warning">
                      {month.thresholdBreachCount} compte
                      {month.thresholdBreachCount > 1 ? "s" : ""}
                    </Badge>
                  ) : summary.thresholds.noneCount <
                      summary.thresholds.accountCount &&
                    month.balanceAfterScenario !== null ? (
                    <Badge tone="positive">OK</Badge>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </section>

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Impact par compte
        </h3>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Le solde enregistré est la somme signée des opérations. Le point bas est le
          minimum projeté sur tout l&apos;horizon. Le seuil se règle dans l&apos;onglet
          Comptes ; à défaut, la simulation le suggère à partir des dépenses.
        </p>

        <div className="mt-3">
          <TableShell caption="Projection par compte">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Compte
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Solde enregistré
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Paiements simulés
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Fin de mois avant
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Fin de mois après
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Point bas
                </th>
                <th scope="col" className={thClass}>
                  Seuil
                </th>
              </tr>
            </thead>
            <tbody>
              {simulation.accounts.map((account) => (
                <tr key={account.id}>
                  <td className={tdClass}>
                    <span className="font-medium">{account.name}</span>
                    {account.archived ? (
                      <span className="ml-2">
                        <Badge tone="neutral">Archivé</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                    {money(account.recordedBalance, simulation.currency, "Inconnu")}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                    {money(account.paymentsTotal, simulation.currency)}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                    {money(account.currentMonthEndBefore, simulation.currency, "Données indisponibles")}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                    {money(account.currentMonthEndAfter, simulation.currency, "Données indisponibles")}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                    {money(account.lowestAfter, simulation.currency, "Données indisponibles")}
                    {account.lowestMonth ? (
                      <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                        {monthLabel(account.lowestMonth)}
                      </span>
                    ) : null}
                  </td>
                  <td className={tdClass}>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {floorSourceLabel(account.floorSource)}
                    </p>
                    <p className="tabular-nums">
                      {money(account.floor, simulation.currency)}
                    </p>
                    {account.thresholdBreached === null ? null : account.thresholdBreached ? (
                      <div className="mt-1 space-y-1">
                        <Badge tone="warning">
                          {account.floorSource === "NONE"
                            ? "Passe négatif"
                            : account.thresholdCausedByScenario
                              ? "Franchi par le scénario"
                              : "Franchi aussi sans le scénario"}
                        </Badge>
                        {account.firstBreachMonth ? (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Premier mois : {monthLabel(account.firstBreachMonth)}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-1">
                        <Badge tone="positive">
                          {account.floorSource === "NONE" ? "Reste positif" : "Respecté"}
                        </Badge>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      </section>

      <SuggestedAllocations simulation={simulation} detailed />

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Chaque paiement, dans l&apos;ordre
        </h3>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Le solde avant/après inclut les opérations et les prévisions datées au plus
          tard le jour du paiement. Le cumul compte tous les paiements du scénario sur
          ce compte.
        </p>

        <div className="mt-3">
          <TableShell caption="Paiements et soldes avant/après">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Date
                </th>
                <th scope="col" className={thClass}>
                  Compte
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Montant
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Cumul compte
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Solde avant
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Solde après
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Global après
                </th>
                <th scope="col" className={thClass}>
                  Seuil
                </th>
              </tr>
            </thead>
            <tbody>
              {simulation.payments.map((payment) => (
                <tr key={`${payment.index}-${payment.operationDate}`}>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {dateLabel(payment.operationDate)}
                  </td>
                  <td className={tdClass}>
                    {payment.accountId === null ? (
                      <>
                        <span className="font-medium">Répartition suggérée</span>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          {payment.allocations.length === 0
                            ? "Aucun compte disponible"
                            : `${payment.allocations.length} compte${
                                payment.allocations.length > 1 ? "s" : ""
                              }`}
                        </span>
                      </>
                    ) : (
                      payment.accountName
                    )}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                    {money(payment.amount, simulation.currency)}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                    {payment.accountId === null
                      ? "—"
                      : money(payment.accountCumulative, simulation.currency)}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                    {payment.accountId === null
                      ? "—"
                      : money(payment.balanceBefore, simulation.currency, "Inconnu")}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                    {payment.accountId === null
                      ? "—"
                      : money(payment.balanceAfter, simulation.currency, "Inconnu")}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                    {money(payment.globalBalanceAfter, simulation.currency, "Inconnu")}
                  </td>
                  <td className={tdClass}>
                    {payment.thresholdBreached === null ? (
                      "—"
                    ) : payment.thresholdBreached ? (
                      <Badge tone="warning">
                        {payment.thresholdCausedByScenario ? "Franchi ici" : "Franchi"}
                      </Badge>
                    ) : (
                      <Badge tone="positive">OK</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      </section>

      {simulation.budget ? (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Impact sur le budget — {simulation.budget.categoryName}
          </h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Réalisé du mois dans cette catégorie et cette devise, avant et après la
            dépense. Le seuil d&apos;alerte est celui de la règle « Seuil de budget ».
          </p>

          {!simulation.budget.hasBudget ? (
            <div className="mt-3">
              <Notice tone="info">
                Aucun budget n&apos;est défini pour cette catégorie sur l&apos;horizon.
                La dépense simulée est visible ci-dessous, mais aucun reste n&apos;est
                calculé : ce n&apos;est pas un budget à zéro.
              </Notice>
            </div>
          ) : null}

          <div className="mt-3">
            <TableShell caption="Impact sur le budget de la catégorie">
              <thead>
                <tr>
                  <th scope="col" className={thClass}>
                    Mois
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Prévu
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Réalisé avant
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Dépense simulée
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Réalisé après
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Reste avant
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Reste après
                  </th>
                  <th scope="col" className={thClass}>
                    État
                  </th>
                </tr>
              </thead>
              <tbody>
                {simulation.budget.rows.map((row) => (
                  <tr key={row.key}>
                    <td className={`${tdClass} whitespace-nowrap font-medium`}>
                      {row.label}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {row.status === "none" ? "—" : money(row.planned, simulation.currency)}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {row.status === "none" ? "—" : money(row.actualBefore, simulation.currency)}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {money(row.simulatedExpense, simulation.currency)}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {row.status === "none" ? "—" : money(row.actualAfter, simulation.currency)}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {row.status === "none" ? "—" : money(row.remainingBefore, simulation.currency)}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {row.status === "none" ? "—" : money(row.remainingAfter, simulation.currency)}
                    </td>
                    <td className={tdClass}>
                      <BudgetBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </div>
        </section>
      ) : null}

      {simulation.warnings.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Points d&apos;attention
          </h3>
          <div className="mt-3 space-y-2">
            {simulation.warnings.map((warning) => (
              <Notice key={warning} tone="warning">
                {warning}
              </Notice>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Hypothèses
        </h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>Le scénario n&apos;écrit aucune transaction et ne modifie aucun seuil.</li>
          <li>
            Le solde de départ est la somme des opérations enregistrées ; les échéances
            en attente et le salaire simulé sont ajoutés mois par mois.
          </li>
          <li>
            Une échéance confirmée est déjà une opération enregistrée : elle n&apos;est
            jamais comptée deux fois.
          </li>
          <li>
            Le salaire simulé avance le solde global de sa devise, pas un compte
            particulier, tant qu&apos;il n&apos;est pas enregistré.
          </li>
          <li>
            Un compte sans opération a un solde inconnu, jamais zéro ; ses projections
            restent vides et il est écarté de la répartition automatique.
          </li>
          <li>
            La répartition suggérée privilégie les comptes courants, espèces et cartes,
            puis les autres comptes, et l&apos;épargne en dernier ; à l&apos;intérieur
            d&apos;une famille, le solde projeté le plus élevé d&apos;abord.
          </li>
          <li>Aucune devise n&apos;est convertie : le scénario reste dans une devise.</li>
        </ul>
      </section>
    </>
  );
}

function SuggestedAllocations({
  simulation,
  detailed = false,
}: {
  simulation: SerializedSimulationResult;
  detailed?: boolean;
}) {
  const autoPayments = simulation.payments.filter(
    (payment) => payment.accountId === null,
  );
  if (autoPayments.length === 0) {
    return null;
  }

  const missing = autoPayments.filter((payment) => payment.allocations.length === 0);
  const partiallyUnallocated = autoPayments.filter(
    (payment) =>
      payment.allocations.length > 0 &&
      new Decimal(payment.unallocatedAmount).greaterThan(0),
  );

  return (
    <section>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Répartition suggérée
      </h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Les comptes courants, espèces et cartes sont utilisés avant les autres
        comptes, et l&apos;épargne en dernier. À l&apos;intérieur d&apos;une même
        famille, le solde projeté le plus élevé passe d&apos;abord. Chaque compte
        garde son propre seuil : configuré, règle globale ou suggestion d&apos;un mois
        de dépenses.
      </p>

      {autoPayments.some((payment) => payment.allocations.length > 0) ? (
        <div className="mt-3">
          <TableShell caption="Répartition suggérée par paiement">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Paiement
                </th>
                <th scope="col" className={thClass}>
                  Compte
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Montant alloué
                </th>
                {detailed ? (
                  <th scope="col" className={`${thClass} text-right`}>
                    Solde avant
                  </th>
                ) : null}
                <th scope="col" className={`${thClass} text-right`}>
                  Solde après
                </th>
                <th scope="col" className={thClass}>
                  Seuil
                </th>
              </tr>
            </thead>
            <tbody>
              {autoPayments.flatMap((payment) =>
                payment.allocations.map((allocation) => (
                  <tr key={`${payment.index}-${allocation.accountId}`}>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      {dateLabel(payment.operationDate)}
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {money(payment.amount, simulation.currency)}
                      </span>
                    </td>
                    <td className={tdClass}>{allocation.accountName}</td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {money(allocation.amount, simulation.currency)}
                    </td>
                    {detailed ? (
                      <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                        {money(allocation.balanceBefore, simulation.currency)}
                      </td>
                    ) : null}
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {money(allocation.balanceAfter, simulation.currency)}
                    </td>
                    <td className={tdClass}>
                      <AllocationBadge allocation={allocation} />
                      <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                        {floorSourceLabel(allocation.floorSource)} ·{" "}
                        {money(allocation.floor, simulation.currency)}
                      </span>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </TableShell>
        </div>
      ) : null}

      {missing.length > 0 ? (
        <div className="mt-3">
          <Notice tone="warning">
            Aucun compte actif avec un solde connu ne peut recevoir{" "}
            {missing
              .map((payment) => money(payment.amount, simulation.currency))
              .join(", ")}
            . Le solde global tient compte de ce montant, mais aucun compte ne le
            porte. Choisissez un compte pour ce paiement ou enregistrez d&apos;abord
            une opération sur un compte.
          </Notice>
        </div>
      ) : null}

      {partiallyUnallocated.map((payment) => (
        <div key={`partial-${payment.index}`} className="mt-3">
          <Notice tone="warning">
            Une partie du paiement du {dateLabel(payment.operationDate)} reste non
            répartie :{" "}
            {money(payment.unallocatedAmount, simulation.currency)} sur{" "}
            {money(payment.amount, simulation.currency)}.
          </Notice>
        </div>
      ))}
    </section>
  );
}

function AllocationBadge({
  allocation,
}: {
  allocation: SerializedSimulationResult["payments"][number]["allocations"][number];
}) {
  if (allocation.floorSource === "NONE") {
    return allocation.preservesFloor ? (
      <Badge tone="positive">Reste positif</Badge>
    ) : (
      <Badge tone="warning">Passe négatif</Badge>
    );
  }

  const label =
    allocation.floorSource === "SUGGESTED"
      ? "Seuil suggéré"
      : allocation.floorSource === "GLOBAL"
        ? "Seuil global"
        : "Seuil";

  return allocation.thresholdBreached ? (
    <Badge tone="warning">{label} non préservé</Badge>
  ) : (
    <Badge tone="positive">{label} préservé</Badge>
  );
}

function BudgetBadge({
  status,
}: {
  status: "ok" | "warning" | "overrun" | "none";
}) {
  if (status === "overrun") {
    return <Badge tone="negative">Dépassé</Badge>;
  }
  if (status === "warning") {
    return <Badge tone="warning">Seuil d&apos;alerte</Badge>;
  }
  if (status === "none") {
    return <Badge tone="neutral">Aucun budget</Badge>;
  }
  return <Badge tone="positive">Dans le budget</Badge>;
}
