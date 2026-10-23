"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type Decimal from "decimal.js";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, Notice, inputClass } from "@/components/ui";
import { parseAmountInput, SUPPORTED_CURRENCIES } from "@/lib/money";
import {
  computeMonthlyPayment,
  loanInputSchema,
  type LoanInput,
} from "@/modules/real-estate/loans";
import { createLoanAction, updateLoanAction } from "./actions";

/** String-only initial values for the edit form: a client never receives a Decimal. */
export type LoanFormValues = {
  id: string;
  propertyId: string;
  label: string;
  currency: string;
  initialPrincipal: string;
  outstandingBalance: string;
  balanceAsOf: string;
  interestRate: string;
  termMonths: string;
  paymentAmount: string;
  insuranceAmount: string;
  startDate: string;
  endDate: string;
  notes: string;
};

const EMPTY: Omit<LoanFormValues, "id"> = {
  propertyId: "",
  label: "",
  currency: "EUR",
  initialPrincipal: "",
  outstandingBalance: "",
  balanceAsOf: "",
  interestRate: "",
  termMonths: "",
  paymentAmount: "",
  insuranceAmount: "",
  startDate: "",
  endDate: "",
  notes: "",
};

/** Form defaults for a create (empty) or an edit (the loan's strings), never the id. */
function formDefaults(
  properties: { id: string; name: string }[],
  loan?: LoanFormValues | null,
): LoanInput {
  if (loan) {
    return {
      propertyId: loan.propertyId,
      label: loan.label,
      currency: loan.currency,
      initialPrincipal: loan.initialPrincipal,
      outstandingBalance: loan.outstandingBalance,
      balanceAsOf: loan.balanceAsOf,
      interestRate: loan.interestRate,
      termMonths: loan.termMonths,
      paymentAmount: loan.paymentAmount,
      insuranceAmount: loan.insuranceAmount,
      startDate: loan.startDate,
      endDate: loan.endDate,
      notes: loan.notes,
    };
  }

  return { ...EMPTY, propertyId: properties[0]?.id ?? "" };
}

/** A hand-typed amount reduced to an exact decimal, or `null` when it does not parse. */
function tryParseAmount(value: string | null | undefined): Decimal | null {
  if (!value) {
    return null;
  }

  try {
    return parseAmountInput(value);
  } catch {
    return null;
  }
}

/** A positive whole number of months, or `null` when the field is empty or unusable. */
function tryParseTerm(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const months = Number(value);
  return Number.isInteger(months) && months > 0 ? months : null;
}

/**
 * Creates or edits a property loan.
 *
 * The same fields serve both: with a loan the identifier is submitted and the update
 * action runs; without one, the creation action does. The loan never feeds the
 * operating totals, so nothing here touches the cashflow figures.
 */
export function LoanForm({
  properties,
  loan,
}: {
  properties: { id: string; name: string }[];
  loan?: LoanFormValues | null;
}) {
  const editing = Boolean(loan?.id);

  const form = useForm<LoanInput>({
    resolver: zodResolver(loanInputSchema, undefined, { raw: true }),
    defaultValues: formDefaults(properties, loan),
  });

  const { result, submit } = useRecordedAction(form, (values) =>
    loan?.id ? updateLoanAction({ ...values, id: loan.id }) : createLoanAction(values),
  );
  const { errors, isSubmitting } = form.formState;

  // The monthly payment is offered from the three figures that determine it. Once the
  // owner types their own value it is left alone — a bank's exact instalment wins over
  // our estimate — and clearing the field hands it back to the suggestion.
  const principalRaw = useWatch({ control: form.control, name: "initialPrincipal" });
  const termRaw = useWatch({ control: form.control, name: "termMonths" });
  const rateRaw = useWatch({ control: form.control, name: "interestRate" });
  const [paymentEdited, setPaymentEdited] = useState(
    Boolean(loan?.paymentAmount && loan.paymentAmount.trim() !== ""),
  );

  useEffect(() => {
    if (paymentEdited) {
      return;
    }

    const principal = tryParseAmount(principalRaw);
    const rate = tryParseAmount(rateRaw);
    const termMonths = tryParseTerm(termRaw);

    if (!principal || rate === null || termMonths === null) {
      return;
    }

    const payment = computeMonthlyPayment({ principal, termMonths, annualRatePercent: rate });
    if (!payment) {
      return;
    }

    const formatted = payment.toFixed(2);
    if (form.getValues("paymentAmount") !== formatted) {
      form.setValue("paymentAmount", formatted, { shouldValidate: false });
    }
  }, [principalRaw, termRaw, rateRaw, paymentEdited, form]);

  // Same rule as the other forms: adopt the first property, never override a choice.
  useEffect(() => {
    if (!form.getValues("propertyId") && properties[0]) {
      form.setValue("propertyId", properties[0].id);
    }
  }, [properties, form]);

  // Keep the form in step with the server after a save: `defaultValues` are read once,
  // on mount, so a refreshed loan (or switching targets) must reset the fields. The
  // page keys this component by loan id, and this effect covers the post-save refresh.
  useEffect(() => {
    form.reset(formDefaults(properties, loan));
  }, [loan, properties, form]);

  if (properties.length === 0) {
    return (
      <Notice tone="warning">
        Aucun bien n&apos;est enregistré. Ajoutez un bien avant de saisir un financement.
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      <Field label="Bien" htmlFor="loan-property" error={errors.propertyId?.message}>
        <select id="loan-property" className={inputClass} {...form.register("propertyId")}>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Libellé"
        htmlFor="loan-label"
        error={errors.label?.message}
        hint="Par exemple : crédit immobilier 2024, prêt travaux."
      >
        <input id="loan-label" className={inputClass} autoComplete="off" {...form.register("label")} />
      </Field>

      <Field label="Devise" htmlFor="loan-currency" error={errors.currency?.message}>
        <select id="loan-currency" className={inputClass} {...form.register("currency")}>
          {SUPPORTED_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Capital emprunté"
        htmlFor="loan-principal"
        error={errors.initialPrincipal?.message}
        hint="Montant positif."
      >
        <input
          id="loan-principal"
          className={inputClass}
          inputMode="decimal"
          placeholder="250000,00"
          autoComplete="off"
          {...form.register("initialPrincipal")}
        />
      </Field>

      <Field
        label="Solde restant dû"
        htmlFor="loan-outstanding"
        error={errors.outstandingBalance?.message}
        hint="Facultatif : sans valeur, le solde reste « inconnu », jamais zéro."
      >
        <input
          id="loan-outstanding"
          className={inputClass}
          inputMode="decimal"
          placeholder="198500,00"
          autoComplete="off"
          {...form.register("outstandingBalance")}
        />
      </Field>

      <Field
        label="Solde observé le"
        htmlFor="loan-balance-as-of"
        error={errors.balanceAsOf?.message}
        hint="À renseigner avec le solde restant dû."
      >
        <input
          id="loan-balance-as-of"
          type="date"
          className={inputClass}
          {...form.register("balanceAsOf")}
        />
      </Field>

      <Field
        label="Taux annuel (%)"
        htmlFor="loan-rate"
        error={errors.interestRate?.message}
        hint="Pourcentage positif, par exemple 3,45."
      >
        <input
          id="loan-rate"
          className={inputClass}
          inputMode="decimal"
          placeholder="3,45"
          autoComplete="off"
          {...form.register("interestRate")}
        />
      </Field>

      <Field
        label="Durée (mois)"
        htmlFor="loan-term"
        error={errors.termMonths?.message}
        hint="Nombre entier de mois."
      >
        <input
          id="loan-term"
          className={inputClass}
          inputMode="numeric"
          placeholder="240"
          autoComplete="off"
          {...form.register("termMonths")}
        />
      </Field>

      <Field
        label="Mensualité"
        htmlFor="loan-payment"
        error={errors.paymentAmount?.message}
        hint="Renseignée automatiquement à partir du capital, de la durée et du taux (formule d'amortissement) — hors assurance. Modifiable."
      >
        <input
          id="loan-payment"
          className={inputClass}
          inputMode="decimal"
          placeholder="1250,00"
          autoComplete="off"
          {...form.register("paymentAmount", {
            // Typing here claims the field; clearing it hands it back to the suggestion.
            onChange: (event) => setPaymentEdited(event.target.value !== ""),
          })}
        />
      </Field>

      <Field
        label="Assurance mensuelle"
        htmlFor="loan-insurance"
        error={errors.insuranceAmount?.message}
      >
        <input
          id="loan-insurance"
          className={inputClass}
          inputMode="decimal"
          placeholder="45,00"
          autoComplete="off"
          {...form.register("insuranceAmount")}
        />
      </Field>

      <Field label="Début" htmlFor="loan-start" error={errors.startDate?.message}>
        <input id="loan-start" type="date" className={inputClass} {...form.register("startDate")} />
      </Field>

      <Field label="Fin" htmlFor="loan-end" error={errors.endDate?.message}>
        <input id="loan-end" type="date" className={inputClass} {...form.register("endDate")} />
      </Field>

      <Field label="Notes" htmlFor="loan-notes" error={errors.notes?.message}>
        <textarea id="loan-notes" rows={2} className={inputClass} {...form.register("notes")} />
      </Field>

      <div className="sm:col-span-2 lg:col-span-3">
        <SubmitButton
          label={editing ? "Enregistrer le prêt" : "Ajouter le prêt"}
          pending={isSubmitting}
        />
      </div>

      <div className="sm:col-span-2 lg:col-span-3">
        <FormFeedback
          result={result}
          successMessage={editing ? "Prêt mis à jour." : "Financement enregistré."}
        />
      </div>
    </form>
  );
}
