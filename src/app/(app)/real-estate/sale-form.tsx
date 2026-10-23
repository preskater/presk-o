"use client";

import Decimal from "decimal.js";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { formatMoney, parseAmountInput, type Currency } from "@/lib/money";
import { propertySaleInputSchema } from "@/modules/real-estate/domain";
import { sellPropertyAction } from "./actions";

/** The identifier stays in the action call: the form only carries what is typed. */
const saleFormSchema = propertySaleInputSchema.omit({ id: true });

type SaleFormInput = { saleDate: string; salePrice: string; saleCosts: string };

export type SaleFormValues = {
  saleDate: string;
  salePrice: string;
  saleCosts: string;
};

/**
 * Records or corrects the sale of one property.
 *
 * The preview mirrors `computeSaleProceeds` on the server: price − costs − recorded
 * debt, then minus the net invested capital. It is display-only — the action
 * recomputes everything before writing, and a figure that cannot be computed is
 * shown as "inconnu" with its reason, never as zero.
 */
export function SaleForm({
  propertyId,
  propertyName,
  currency,
  netInvested,
  outstandingDebt,
  unknownLoanBalances,
  foreignCurrencyLoans,
  sale,
  compact = false,
}: {
  propertyId: string;
  propertyName: string;
  currency: Currency;
  /** Net invested capital and recorded debt as decimal strings, or null when unknown. */
  netInvested: string | null;
  outstandingDebt: string | null;
  unknownLoanBalances: number;
  foreignCurrencyLoans: number;
  sale?: SaleFormValues | null;
  /** Narrow vertical layout, for the list row panel. */
  compact?: boolean;
}) {
  const editing = Boolean(sale?.saleDate);

  const form = useForm<SaleFormInput>({
    resolver: zodResolver(saleFormSchema, undefined, { raw: true }),
    defaultValues: {
      saleDate: sale?.saleDate ?? "",
      salePrice: sale?.salePrice ?? "",
      saleCosts: sale?.saleCosts ?? "0",
    },
  });

  const { result, submit } = useRecordedAction(
    form,
    (values) => sellPropertyAction({ ...values, id: propertyId }),
    { keepValues: true },
  );
  const { errors, isSubmitting } = form.formState;

  const salePrice = useWatch({ control: form.control, name: "salePrice" });
  const saleCosts = useWatch({ control: form.control, name: "saleCosts" });
  const preview = previewSale(salePrice, saleCosts, netInvested, outstandingDebt, currency);

  return (
    <form
      onSubmit={submit}
      className={compact ? "flex w-60 flex-col gap-2" : "grid gap-3 sm:grid-cols-3"}
      noValidate
      aria-label={`Cession de ${propertyName}`}
    >
      <Field
        label="Date de cession"
        htmlFor={`sale-date-${propertyId}`}
        error={errors.saleDate?.message}
      >
        <input
          id={`sale-date-${propertyId}`}
          type="date"
          className={inputClass}
          {...form.register("saleDate")}
        />
      </Field>

      <Field
        label="Prix de vente"
        htmlFor={`sale-price-${propertyId}`}
        error={errors.salePrice?.message}
        hint={`Devise : ${currency}.`}
      >
        <input
          id={`sale-price-${propertyId}`}
          className={inputClass}
          inputMode="decimal"
          autoComplete="off"
          {...form.register("salePrice")}
        />
      </Field>

      <Field
        label="Frais de cession"
        htmlFor={`sale-costs-${propertyId}`}
        error={errors.saleCosts?.message}
        hint="Agence, diagnostics… 0 si aucun."
      >
        <input
          id={`sale-costs-${propertyId}`}
          className={inputClass}
          inputMode="decimal"
          autoComplete="off"
          {...form.register("saleCosts")}
        />
      </Field>

      <div className={compact ? "text-xs" : "text-sm sm:col-span-3"}>
        <p className="font-medium">Ce que la vente rapporterait</p>
        {preview.proceeds ? (
          <p className="tabular-nums">
            Produit net (prix − frais − dette) : {preview.proceeds}
          </p>
        ) : (
          <p className="text-zinc-500 dark:text-zinc-400">{preview.proceedsReason}</p>
        )}
        {preview.gain ? (
          <p className="tabular-nums">Gain net : {preview.gain}</p>
        ) : preview.gainReason !== preview.proceedsReason ? (
          <p className="text-zinc-500 dark:text-zinc-400">{preview.gainReason}</p>
        ) : null}
      </div>

      <div className={compact ? "" : "sm:col-span-3"}>
        <SubmitButton
          label={editing ? "Mettre à jour la cession" : "Enregistrer la cession"}
          pending={isSubmitting}
        />
      </div>

      <div className={compact ? "" : "sm:col-span-3"}>
        <FormFeedback
          result={result}
          successMessage={editing ? "Cession mise à jour." : "Cession enregistrée."}
        />
      </div>

      {unknownLoanBalances > 0 || foreignCurrencyLoans > 0 ? (
        <p className={`text-xs text-amber-700 dark:text-amber-300 ${compact ? "" : "sm:col-span-3"}`}>
          {foreignCurrencyLoans > 0
            ? `${foreignCurrencyLoans} prêt(s) dans une autre devise : la dette reste inconnue, aucune conversion n'est faite.`
            : `${unknownLoanBalances} prêt(s) sans solde renseigné : la dette reste inconnue, jamais zéro.`}
        </p>
      ) : null}
    </form>
  );
}

function previewSale(
  salePriceInput: string,
  saleCostsInput: string,
  netInvested: string | null,
  outstandingDebt: string | null,
  currency: Currency,
): {
  proceeds: string | null;
  proceedsReason: string;
  gain: string | null;
  gainReason: string;
} {
  const price = parseOptional(salePriceInput);
  const costs = parseOptional(saleCostsInput);
  const debt = outstandingDebt === null ? null : new Decimal(outstandingDebt);
  const invested = netInvested === null ? null : new Decimal(netInvested);

  if (price === null || costs === null) {
    const reason = "Saisissez le prix et les frais pour voir le produit net.";
    return { proceeds: null, proceedsReason: reason, gain: null, gainReason: reason };
  }

  if (debt === null) {
    const reason = "Produit net inconnu : la dette d'un prêt n'est pas renseignée.";
    return { proceeds: null, proceedsReason: reason, gain: null, gainReason: reason };
  }

  const proceeds = price.minus(costs).minus(debt);
  const proceedsText = formatMoney({ amount: proceeds, currency });

  if (invested === null) {
    return {
      proceeds: proceedsText,
      proceedsReason: "",
      gain: null,
      gainReason: "Gain inconnu : le prix d'acquisition n'est pas renseigné.",
    };
  }

  const gain = proceeds.minus(invested);

  return {
    proceeds: proceedsText,
    proceedsReason: "",
    gain: formatMoney({ amount: gain, currency }),
    gainReason: "",
  };
}

function parseOptional(value: string): Decimal | null {
  if (!value.trim()) {
    return null;
  }

  try {
    return parseAmountInput(value);
  } catch {
    return null;
  }
}
