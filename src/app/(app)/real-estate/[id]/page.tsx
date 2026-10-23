import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Card,
  Notice,
  PageHeader,
  StatCard,
  TableShell,
  tdClass,
  thClass,
} from "@/components/ui";
import { requireUser } from "@/lib/auth/guard";
import { formatDateOnly, toDateOnlyString } from "@/lib/dates";
import { formatMoney, type Currency } from "@/lib/money";
import type Decimal from "decimal.js";
import type { PropertyOccupancy } from "@/modules/real-estate/domain";
import { getPropertyDetail } from "@/modules/real-estate/repository";
import {
  buildPropertyHistory,
  propertyHistoryKindLabel,
  type PropertyHistoryEvent,
} from "@/modules/real-estate/history";
import type { SaleStatus } from "@/modules/real-estate/valuation";
import { PropertyForm, type PropertyFormValues } from "../property-form";
import { SaleForm, type SaleFormValues } from "../sale-form";
import { RemovePropertyButton } from "../remove-property-button";

export const dynamic = "force-dynamic";

const OCCUPANCY_LABELS: Record<PropertyOccupancy, string> = {
  RENTED: "Loué",
  VACANT: "Vacant",
  OWNER_OCCUPIED: "Occupé par le propriétaire",
  SEASONAL: "Saisonnier",
  OTHER: "Autre",
};

const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  SOLD: "Vendu",
  NO_ESTIMATE: "Valeur estimée à renseigner",
  UNKNOWN: "Données incomplètes",
  BELOW_TARGET: "Sous l'objectif",
  TARGET_REACHED: "Objectif atteint",
};

/** A figure that was never recorded reads "inconnu", never zero. */
function formatOptionalMoney(amount: Decimal | null, currency: Currency): string {
  return amount === null ? "inconnu" : formatMoney({ amount, currency });
}

function decimalText(amount: Decimal | null): string | null {
  return amount === null ? null : amount.toFixed(2);
}

function historyAmount(event: PropertyHistoryEvent): string {
  if (event.amount === null) {
    return "inconnu";
  }

  const text = formatMoney({ amount: event.amount, currency: event.currency });

  if (event.direction === "INFLOW") {
    return `+ ${text}`;
  }

  if (event.direction === "OUTFLOW") {
    return `− ${text}`;
  }

  return text;
}

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const property = await getPropertyDetail(user.id, id);

  if (!property) {
    notFound();
  }

  const analysis = property.analysis;
  const currency = property.priceCurrency;

  const formValues: PropertyFormValues = {
    id: property.id,
    name: property.name,
    address: property.address ?? "",
    occupancy: property.occupancy,
    currency: property.priceCurrency,
    purchaseDate: property.purchaseDate ? toDateOnlyString(property.purchaseDate) : "",
    purchasePrice: property.purchasePrice ? property.purchasePrice.toFixed(2) : "",
    estimatedValue: property.estimatedValue ? property.estimatedValue.toFixed(2) : "",
    estimatedValueAsOf: property.estimatedValueAsOf
      ? toDateOnlyString(property.estimatedValueAsOf)
      : "",
    targetGainRate: property.targetGainRate.toFixed(2),
    notes: property.notes ?? "",
  };

  const saleFormValues: SaleFormValues | null = analysis.sale
    ? {
        saleDate: toDateOnlyString(analysis.sale.date),
        salePrice: analysis.sale.price ? analysis.sale.price.toFixed(2) : "",
        saleCosts: analysis.sale.costs ? analysis.sale.costs.toFixed(2) : "0",
      }
    : null;

  const history = buildPropertyHistory({
    currency,
    purchaseDate: property.purchaseDate,
    purchasePrice: property.purchasePrice,
    estimatedValue: property.estimatedValue,
    estimatedValueAsOf: property.estimatedValueAsOf,
    saleDate: property.saleDate,
    salePrice: property.salePrice,
    cashflows: property.cashflows,
    loans: property.loans,
  });

  const removable = {
    id: property.id,
    name: property.name,
    currency,
    saleDate: property.saleDate ? toDateOnlyString(property.saleDate) : null,
    sale: saleFormValues,
    netInvested: decimalText(analysis.netInvested),
    outstandingDebt: decimalText(analysis.outstandingDebt),
    unknownLoanBalances: analysis.unknownLoanBalances,
    foreignCurrencyLoans: analysis.foreignCurrencyLoans,
  };

  return (
    <>
      <PageHeader
        title={property.name}
        description={
          <>
            {OCCUPANCY_LABELS[property.occupancy]}
            {property.address ? ` · ${property.address}` : ""}
            {property.saleDate ? ` · vendu le ${formatDateOnly(property.saleDate)}` : ""}
          </>
        }
        actions={
          <Link
            href="/real-estate"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ← Tous les biens
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge tone={property.occupancy === "RENTED" ? "positive" : "neutral"}>
          {OCCUPANCY_LABELS[property.occupancy]}
        </Badge>
        {property.saleDate ? <Badge tone="negative">Vendu</Badge> : null}
        {analysis.status === "SOLD" ? null : (
          <Badge tone={analysis.status === "TARGET_REACHED" ? "positive" : "warning"}>
            {SALE_STATUS_LABELS[analysis.status]}
          </Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={`Prix d'acquisition (${currency})`}
          value={formatOptionalMoney(property.purchasePrice, currency)}
          hint={property.purchaseDate ? `Acquis le ${formatDateOnly(property.purchaseDate)}` : undefined}
        />
        <StatCard
          label={`Recettes (${property.currency})`}
          value={formatMoney({ amount: property.income, currency: property.currency })}
        />
        <StatCard
          label={`Charges (${property.currency})`}
          value={formatMoney({ amount: property.expenses, currency: property.currency })}
        />
        <StatCard
          label={`Solde d'exploitation (${property.currency})`}
          value={formatMoney({ amount: property.net, currency: property.currency })}
          tone={property.net.isNegative() ? "negative" : "neutral"}
        />
        <StatCard
          label={`Capital net engagé (${currency})`}
          value={formatOptionalMoney(analysis.netInvested, currency)}
          hint="Prix d'acquisition + charges − recettes"
        />
        <StatCard
          label={`Dette restante (${currency})`}
          value={formatOptionalMoney(analysis.outstandingDebt, currency)}
          hint={
            analysis.unknownLoanBalances > 0
              ? `${analysis.unknownLoanBalances} prêt(s) sans solde : dette inconnue`
              : analysis.foreignCurrencyLoans > 0
                ? "Prêt(s) dans une autre devise : aucune conversion"
                : "Somme des soldes de prêts enregistrés"
          }
        />
      </div>

      <Card
        title="Quand vendre, à quel prix ?"
        description="Indicateur déterministe, calculé uniquement avec vos montants enregistrés. Il ne prévoit pas les prix de marché et ne constitue pas un conseil financier."
      >
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label={`Seuil de cession (${currency})`}
              value={formatOptionalMoney(analysis.breakEvenPrice, currency)}
              hint="Prix de vente sans perte : capital net engagé + dette, hors frais."
            />
            <StatCard
              label={`Prix cible (+${property.targetGainRate.toFixed(2)} %) (${currency})`}
              value={formatOptionalMoney(analysis.targetPrice, currency)}
              hint="Seuil + objectif de plus-value × capital net engagé."
            />
            <StatCard
              label={`Valeur estimée (${currency})`}
              value={formatOptionalMoney(analysis.estimatedValue, currency)}
              hint={
                analysis.estimatedValueAsOf
                  ? `Estimation du ${formatDateOnly(analysis.estimatedValueAsOf)}`
                  : "Aucune estimation datée enregistrée."
              }
            />
            <StatCard
              label={`Valeur nette estimée (${currency})`}
              value={formatOptionalMoney(analysis.estimatedEquity, currency)}
              hint="Valeur estimée − dette restante."
            />
            <StatCard
              label={`Gain estimé à cette valeur (${currency})`}
              value={formatOptionalMoney(analysis.estimatedGain, currency)}
              tone={
                analysis.estimatedGain === null
                  ? "neutral"
                  : analysis.estimatedGain.lessThan(0)
                    ? "negative"
                    : "positive"
              }
              hint="Valeur nette estimée − capital net engagé, hors frais de cession."
            />
            <StatCard
              label={`Écart au prix cible (${currency})`}
              value={
                analysis.gapToTarget === null
                  ? "inconnu"
                  : analysis.gapToTarget.greaterThan(0)
                    ? `il manque ${formatMoney({ amount: analysis.gapToTarget, currency })}`
                    : `dépassé de ${formatMoney({
                        amount: analysis.gapToTarget.abs(),
                        currency,
                      })}`
              }
              tone={
                analysis.gapToTarget === null
                  ? "neutral"
                  : analysis.gapToTarget.greaterThan(0)
                    ? "warning"
                    : "positive"
              }
              hint="Prix cible − valeur estimée, hors frais de cession."
            />
          </div>

          {analysis.status === "NO_ESTIMATE" ? (
            <Notice tone="info">
              Renseignez une valeur estimée (et sa date) pour situer le bien par rapport
              au prix cible.
            </Notice>
          ) : null}

          {analysis.status === "UNKNOWN" ? (
            <Notice tone="warning">
              L&apos;indicateur reste incomplet : le prix d&apos;acquisition, le solde
              d&apos;un prêt ou la devise des flux manque. Une donnée absente reste
              « inconnue », jamais zéro.
            </Notice>
          ) : null}

          {analysis.currencyMismatch ? (
            <Notice tone="warning">
              Les flux de ce bien ne sont pas dans la devise de ses prix ({currency}) :
              aucun total n&apos;est converti, donc les indicateurs restent inconnus.
            </Notice>
          ) : null}

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Formules : capital net engagé = prix d&apos;acquisition + charges cumulées −
            recettes cumulées ; seuil de cession = capital net engagé + dette restante ;
            prix cible = seuil + objectif de plus-value × capital net engagé. Les frais
            de cession ne sont déduits qu&apos;au moment de la vente enregistrée.
          </p>
        </div>
      </Card>

      <Card
        title={property.saleDate ? "Cession enregistrée" : "Vendre ce bien"}
        description={
          property.saleDate
            ? "Le bien reste suivi : ses flux, ses prêts et son historique sont conservés. Corrigez la cession si nécessaire."
            : "Vendre conserve le bien et son historique ; supprimer l'efface. La vente enregistre la date, le prix et les frais, puis affiche le gain net."
        }
      >
        <div className="flex flex-col gap-4">
          {analysis.sale ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label={`Prix de vente (${currency})`}
                value={formatOptionalMoney(analysis.sale.price, currency)}
                hint={`Vendu le ${formatDateOnly(analysis.sale.date)}`}
              />
              <StatCard
                label={`Frais de cession (${currency})`}
                value={formatOptionalMoney(analysis.sale.costs, currency)}
              />
              <StatCard
                label={`Produit net (${currency})`}
                value={formatOptionalMoney(analysis.sale.netProceeds, currency)}
                hint="Prix − frais − dette restante"
              />
              <StatCard
                label={`Gain net de la vente (${currency})`}
                value={formatOptionalMoney(analysis.sale.gain, currency)}
                tone={
                  analysis.sale.gain === null
                    ? "neutral"
                    : analysis.sale.gain.lessThan(0)
                      ? "negative"
                      : "positive"
                }
                hint="Produit net − capital net engagé"
              />
            </div>
          ) : null}

          <SaleForm
            key={property.saleDate ? "sale-edit" : "sale-new"}
            propertyId={property.id}
            propertyName={property.name}
            currency={currency}
            netInvested={decimalText(analysis.netInvested)}
            outstandingDebt={decimalText(analysis.outstandingDebt)}
            unknownLoanBalances={analysis.unknownLoanBalances}
            foreignCurrencyLoans={analysis.foreignCurrencyLoans}
            sale={saleFormValues}
          />
        </div>
      </Card>

      <Card
        id="modifier"
        title="Modifier le bien"
        description="Le prix d'acquisition et la valeur estimée nourrissent l'indicateur de cession. Une valeur vide reste « inconnue »."
      >
        <PropertyForm key={property.id} property={formValues} />
      </Card>

      <Card
        title="Historique"
        description="Acquisition, flux, financements, estimations et cession, du plus récent au plus ancien. Un flux lié à une transaction reprend son montant : rien n'est compté deux fois."
      >
        {history.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Aucun événement daté pour ce bien. Renseignez une date d&apos;acquisition ou
            ajoutez un flux pour commencer l&apos;historique.
          </p>
        ) : (
          <TableShell caption="Historique du bien">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Date
                </th>
                <th scope="col" className={thClass}>
                  Type
                </th>
                <th scope="col" className={thClass}>
                  Événement
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Montant
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((event) => (
                <tr key={event.id}>
                  <td className={`${tdClass} whitespace-nowrap`}>{formatDateOnly(event.date)}</td>
                  <td className={tdClass}>{propertyHistoryKindLabel(event.kind)}</td>
                  <td className={tdClass}>
                    <span className="font-medium">{event.title}</span>
                    {event.detail ? (
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {event.detail}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={`${tdClass} text-right tabular-nums ${
                      event.direction === "INFLOW"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : event.direction === "OUTFLOW"
                          ? "text-rose-700 dark:text-rose-400"
                          : ""
                    }`}
                  >
                    {historyAmount(event)}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>

      <Card
        title="Supprimer le bien"
        description="La suppression efface le bien, ses flux et ses prêts. Elle est définitive et ne produit aucun gain : pour conserver l'historique, enregistrez plutôt une cession."
      >
        <RemovePropertyButton property={removable} afterDelete="list" allowSell={false} />
      </Card>

      {property.notes ? (
        <Card title="Notes">
          <p className="whitespace-pre-wrap text-sm">{property.notes}</p>
        </Card>
      ) : null}
    </>
  );
}
