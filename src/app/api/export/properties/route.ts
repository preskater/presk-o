import { requireApiUser, unauthorizedResponse, moduleUnavailableResponse } from "@/lib/auth/guard";
import { hasModule } from "@/modules/catalog/catalog";
import { createCsvResponse, toCsv, type CsvColumn } from "@/lib/csv";
import { toDateOnlyString } from "@/lib/dates";
import { listProperties } from "@/modules/real-estate/repository";

/** CSV export of the properties, with their totals. Authenticated server-side. */
export const dynamic = "force-dynamic";

type PropertyRow = {
  name: string;
  address: string;
  occupancy: string;
  purchaseDate: string;
  purchasePrice: string;
  estimatedValue: string;
  estimatedValueAsOf: string;
  targetGainRate: string;
  saleDate: string;
  salePrice: string;
  saleCosts: string;
  currency: string;
  priceCurrency: string;
  income: string;
  expenses: string;
  net: string;
  cashflowCount: string;
  notes: string;
};

const COLUMNS: CsvColumn<PropertyRow>[] = [
  { key: "name", header: "nom" },
  { key: "address", header: "adresse" },
  { key: "occupancy", header: "occupation" },
  { key: "purchaseDate", header: "date_acquisition" },
  { key: "purchasePrice", header: "prix_acquisition" },
  { key: "estimatedValue", header: "valeur_estimee" },
  { key: "estimatedValueAsOf", header: "valeur_estimee_au" },
  { key: "targetGainRate", header: "objectif_plus_value_pct" },
  { key: "saleDate", header: "date_cession" },
  { key: "salePrice", header: "prix_cession" },
  { key: "saleCosts", header: "frais_cession" },
  { key: "currency", header: "devise" },
  { key: "priceCurrency", header: "devise_prix" },
  { key: "income", header: "recettes" },
  { key: "expenses", header: "charges" },
  { key: "net", header: "solde" },
  { key: "cashflowCount", header: "nombre_de_flux" },
  { key: "notes", header: "notes" },
];

export async function GET(): Promise<Response> {
  const user = await requireApiUser();
  if (!user) {
    return unauthorizedResponse();
  }
  if (!hasModule(user.workspace, "real-estate")) {
    return moduleUnavailableResponse();
  }

  const properties = await listProperties(user.id);

  const rows: PropertyRow[] = properties.map((property) => ({
    name: property.name,
    address: property.address ?? "",
    occupancy: property.occupancy,
    purchaseDate: property.purchaseDate ? toDateOnlyString(property.purchaseDate) : "",
    purchasePrice: property.purchasePrice ? property.purchasePrice.toFixed(2) : "",
    estimatedValue: property.estimatedValue ? property.estimatedValue.toFixed(2) : "",
    estimatedValueAsOf: property.estimatedValueAsOf
      ? toDateOnlyString(property.estimatedValueAsOf)
      : "",
    targetGainRate: property.targetGainRate.toFixed(2),
    saleDate: property.saleDate ? toDateOnlyString(property.saleDate) : "",
    salePrice: property.salePrice ? property.salePrice.toFixed(2) : "",
    saleCosts: property.saleCosts ? property.saleCosts.toFixed(2) : "",
    currency: property.currency,
    priceCurrency: property.priceCurrency,
    income: property.income.toFixed(2),
    expenses: property.expenses.toFixed(2),
    net: property.net.toFixed(2),
    cashflowCount: String(property.cashflowCount),
    notes: property.notes ?? "",
  }));

  return createCsvResponse(toCsv(rows, COLUMNS), "immobilier.csv");
}
