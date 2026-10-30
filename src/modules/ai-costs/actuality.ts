/**
 * How much trust a cost figure deserves.
 *
 * Actuality is mandatory on every amount: a number without it would be a guess
 * disguised as a measurement. The vocabulary is closed — provider adapters,
 * imports and manual entry all translate into one of these five states.
 */
export const ACTUALITIES = [
  "observed",
  "derived",
  "allocated",
  "estimated",
  "reconciled",
] as const;

export type Actuality = (typeof ACTUALITIES)[number];

export const ACTUALITY_LABELS: Record<Actuality, string> = {
  observed: "Constaté",
  derived: "Calculé",
  allocated: "Réparti",
  estimated: "Estimé",
  reconciled: "Rapproché",
};

export const ACTUALITY_DESCRIPTIONS: Record<Actuality, string> = {
  observed: "Lu directement dans une source de facturation ou de consommation.",
  derived: "Calculé à partir de valeurs constatées par une règle documentée.",
  allocated: "Part d'un montant plus large, répartie par une politique d'allocation.",
  estimated: "Ordre de grandeur assumé, faute de mesure disponible.",
  reconciled: "Vérifié après coup contre une facture ou un relevé de référence.",
};

export class InvalidActualityError extends Error {
  constructor(readonly input: unknown) {
    super(`Invalid actuality: expected one of ${ACTUALITIES.join(", ")}.`);
    this.name = "InvalidActualityError";
  }
}

export function isActuality(value: unknown): value is Actuality {
  return (
    typeof value === "string" &&
    (ACTUALITIES as readonly string[]).includes(value)
  );
}

/** Rejects anything else, including case variants such as `"OBSERVED"`. */
export function assertActuality(value: unknown): Actuality {
  if (!isActuality(value)) {
    throw new InvalidActualityError(value);
  }

  return value;
}
