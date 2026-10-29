"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { propertyValuationInputSchema, type PropertyValuationInput } from "@/modules/real-estate/domain";
import { createPropertyValuationAction } from "./actions";

export function ValuationForm({
  propertyId,
  currency,
}: {
  propertyId: string;
  currency: string;
}) {
  const form = useForm<PropertyValuationInput>({
    resolver: zodResolver(propertyValuationInputSchema, undefined, { raw: true }),
    defaultValues: { propertyId, valuedOn: "", amount: "", currency, sourceNote: "" },
  });
  const { result, submit } = useRecordedAction(form, (values) =>
    createPropertyValuationAction(values),
  );
  const { errors, isSubmitting } = form.formState;

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" noValidate>
      <input type="hidden" {...form.register("propertyId")} />
      <input type="hidden" {...form.register("currency")} />
      <Field label="Date de valorisation" htmlFor="valuation-date" error={errors.valuedOn?.message}>
        <input id="valuation-date" type="date" className={inputClass} {...form.register("valuedOn")} />
      </Field>
      <Field label={`Montant (${currency})`} htmlFor="valuation-amount" error={errors.amount?.message}>
        <input id="valuation-amount" className={inputClass} inputMode="decimal" {...form.register("amount")} />
      </Field>
      <Field label="Source / note" htmlFor="valuation-note" error={errors.sourceNote?.message}>
        <input id="valuation-note" className={inputClass} {...form.register("sourceNote")} />
      </Field>
      <div className="flex items-end">
        <SubmitButton label="Ajouter" pending={isSubmitting} />
      </div>
      <FormFeedback result={result} successMessage="Valorisation ajoutée." />
    </form>
  );
}
