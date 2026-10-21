"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import type { Currency } from "@/lib/money";
import { deletePropertyAction } from "./actions";
import { SaleForm, type SaleFormValues } from "./sale-form";

export type RemovableProperty = {
  id: string;
  name: string;
  currency: Currency;
  saleDate: string | null;
  sale: SaleFormValues | null;
  netInvested: string | null;
  outstandingDebt: string | null;
  unknownLoanBalances: number;
  foreignCurrencyLoans: number;
};

/**
 * Removes a property, in two distinct ways.
 *
 * A sale and a deletion are not the same decision, so the panel asks which one is
 * meant before anything is written: selling keeps the property, its history and the
 * gain the sale produced, while deleting erases the row with its cashflows and loans.
 * The confirmation is a state of the component rather than `window.confirm`, so it
 * stays readable and names what is about to disappear.
 */
export function RemovePropertyButton({
  property,
  afterDelete = "refresh",
  allowSell = true,
}: {
  property: RemovableProperty;
  /** The detail page redirects to the list once the row it displays is gone. */
  afterDelete?: "refresh" | "list";
  /** False when the surrounding page already offers the sale form. */
  allowSell?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "choose" | "sell" | "delete">("idle");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(): void {
    startTransition(async () => {
      const outcome = await deletePropertyAction({ id: property.id });
      setResult(outcome);

      if (outcome.status === "ok") {
        if (afterDelete === "list") {
          router.push("/real-estate");
        } else {
          router.refresh();
        }
      }
    });
  }

  if (mode === "idle") {
    return (
      <button
        type="button"
        onClick={() => {
          setResult(null);
          setMode("choose");
        }}
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        Retirer
      </button>
    );
  }

  return (
    <div className="flex max-w-72 flex-col gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
      <p className="text-xs">
        {allowSell && !property.saleDate
          ? `Retirer « ${property.name} » : vendez-le ou supprimez-le définitivement.`
          : `Supprimer « ${property.name} » définitivement ?`}
      </p>

      {allowSell && property.saleDate ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Cession déjà enregistrée. Corrigez-la depuis la fiche du bien.
        </p>
      ) : null}

      {mode === "choose" ? (
        <div className="flex flex-wrap gap-1">
          {allowSell && !property.saleDate ? (
            <button
              type="button"
              onClick={() => setMode("sell")}
              className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Je vends ce bien
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setMode("delete")}
            className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
          >
            Je le supprime
          </button>
          <button
            type="button"
            onClick={() => setMode("idle")}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Annuler
          </button>
        </div>
      ) : null}

      {mode === "sell" ? (
        <>
          <p className="text-xs font-medium">Vente du bien</p>
          <SaleForm
            propertyId={property.id}
            propertyName={property.name}
            currency={property.currency}
            netInvested={property.netInvested}
            outstandingDebt={property.outstandingDebt}
            unknownLoanBalances={property.unknownLoanBalances}
            foreignCurrencyLoans={property.foreignCurrencyLoans}
            sale={property.sale}
            compact
          />
          <button
            type="button"
            onClick={() => setMode("choose")}
            className="self-start rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Retour
          </button>
        </>
      ) : null}

      {mode === "delete" ? (
        <>
          <p className="text-xs text-rose-700 dark:text-rose-400">
            Supprimer « {property.name} » avec ses flux, ses prêts et sa cession ? Cette
            action est définitive.
          </p>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="rounded-md bg-rose-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
            >
              {pending ? "Suppression..." : "Supprimer définitivement"}
            </button>
            <button
              type="button"
              onClick={() => setMode("choose")}
              disabled={pending}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Annuler
            </button>
          </span>
        </>
      ) : null}

      {result && result.status !== "ok" ? (
        <span className="text-xs text-rose-700 dark:text-rose-400" role="alert">
          {result.message}
        </span>
      ) : null}

      {result?.status === "ok" && result.message ? (
        <span className="text-xs text-zinc-600 dark:text-zinc-400">{result.message}</span>
      ) : null}
    </div>
  );
}
