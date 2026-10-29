"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { Currency } from "@/lib/money";

/**
 * The month's balance, day after day, with the three series that explain it:
 *
 * - **solde enregistré** — what the accounts really hold;
 * - **échéances du mois** — the undecided movements cumulated from zero, i.e. their
 *   weight so far (not a balance: it is the line a reader compares against zero);
 * - **simulé cumulé** — the previous month's simulated, not-yet-recorded movements
 *   (undecided échéances and simulated salary), plus recorded, plus échéances: the same
 *   simulated balance the Prévisions schedule shows, accumulated day by day, i.e. where the
 *   month ends up if every pending movement goes through.
 *
 * A step line, because a balance only changes on the day of a movement. Each line can be
 * hidden from the legend — hiding two of them is how a reader isolates the one they care
 * about — and the axis rescales to the lines still shown. The exact figures are printed
 * under the drawing: a chart is never the only way to read a value.
 * Client-side (Recharts), as shadcn/ui charts are; the data arrives pre-computed from the
 * server, and no `Decimal` crosses the boundary.
 */
export type MonthBalanceRow = {
  /** Calendar day, 1-based. */
  day: number;
  /** "01/10" — the axis label and the tooltip's heading. */
  label: string;
  recorded: number;
  echeances: number;
  simulated: number;
};

/**
 * One descriptor per series, shared by the lines, the legend and the tooltip, so a colour
 * can never mean two different things.
 */
const SERIES = [
  { key: "recorded", label: "Solde enregistré", color: "var(--chart-1)", dash: undefined },
  { key: "echeances", label: "Échéances du mois", color: "var(--chart-2)", dash: "1 4" },
  { key: "simulated", label: "Simulé cumulé", color: "var(--chart-3)", dash: "5 4" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

/** "d'octobre", "de septembre": the French elision, so the sentence reads correctly. */
function fromMonth(label: string): string {
  return /^[aeiouyàâäéèêëîïôöûü]/i.test(label) ? `d'${label}` : `de ${label}`;
}

const chartConfig = {
  recorded: { label: SERIES[0].label, color: SERIES[0].color },
  echeances: { label: SERIES[1].label, color: SERIES[1].color },
  simulated: { label: SERIES[2].label, color: SERIES[2].color },
} satisfies ChartConfig;

export function MonthBalanceChart({
  rows,
  currency,
  opening,
  carryOver = 0,
  previousMonthLabel,
}: {
  rows: MonthBalanceRow[];
  currency: Currency;
  /** Recorded balance strictly before the month, printed as the starting point. */
  opening: number;
  /** Simulated net of the previous month the ledger never received; zero when none. */
  carryOver?: number;
  /** The previous month's name, for the carry-over sentence. */
  previousMonthLabel?: string;
}) {
  // Hidden series, by key. Empty means everything is shown, which is the default.
  const [hidden, setHidden] = useState<ReadonlySet<SeriesKey>>(new Set());
  const visible = SERIES.filter((series) => !hidden.has(series.key));

  const money = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const compact = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  });

  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Aucune journée à afficher.
      </p>
    );
  }

  function toggle(key: SeriesKey) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const last = rows[rows.length - 1];
  const lowPoint = rows.reduce((low, row) => (row.simulated < low.simulated ? row : low), rows[0]);

  // The axis spans the **visible** series plus a small margin, so isolating a line also
  // gives it the whole height, and it neither floats above the data nor wastes a band of
  // empty space below it (Recharts' "nice" ticks would). With everything hidden the axis
  // falls back to the full data, so the drawing never collapses to NaN.
  const shown = visible.length > 0 ? visible : SERIES;
  const values = rows.flatMap((row) => shown.map((series) => row[series.key]));
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const margin = (highest - lowest || 1) * 0.08;
  const domain: [number, number] = [lowest - margin, highest + margin];

  return (
    <div className="flex flex-col gap-2">
      <ChartContainer config={chartConfig} className="h-72 w-full">
        <LineChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
          />
          <YAxis
            domain={domain}
            tickLine={false}
            axisLine={false}
            width={72}
            tickFormatter={(value: number) => compact.format(value)}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                className="border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                // A formatter replaces the default row entirely, so it must print the
                // swatch and the series name itself — otherwise three amounts stack up
                // with nothing saying which line each one comes from.
                formatter={(value, name, item) => {
                  const series =
                    SERIES.find((candidate) => candidate.key === item?.dataKey) ??
                    SERIES.find((candidate) => candidate.key === name);

                  return (
                    <span className="flex w-full items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: series?.color }}
                      />
                      <span className="flex-1 text-zinc-500 dark:text-zinc-400">
                        {series?.label ?? String(name)}
                      </span>
                      <span className="font-medium tabular-nums">
                        {money.format(Number(value))}
                      </span>
                    </span>
                  );
                }}
              />
            }
          />
          {SERIES.map((series) => (
            <Line
              key={series.key}
              dataKey={series.key satisfies SeriesKey}
              type="stepAfter"
              stroke={`var(--color-${series.key})`}
              strokeWidth={2}
              strokeDasharray={series.dash}
              dot={false}
              isAnimationActive={false}
              hide={hidden.has(series.key)}
            />
          ))}
        </LineChart>
      </ChartContainer>

      {/* Legend as toggles: hiding two lines is how a reader isolates the one they want. */}
      <div className="flex flex-wrap items-center gap-2">
        {SERIES.map((series) => {
          const isHidden = hidden.has(series.key);

          return (
            <button
              key={series.key}
              type="button"
              aria-pressed={!isHidden}
              onClick={() => toggle(series.key)}
              title={
                isHidden ? `Afficher « ${series.label} »` : `Masquer « ${series.label} »`
              }
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 shrink-0 rounded-[2px] border"
                style={{
                  backgroundColor: isHidden ? "transparent" : series.color,
                  borderColor: series.color,
                }}
              />
              <span className={isHidden ? "line-through opacity-60" : undefined}>
                {series.label}
              </span>
            </button>
          );
        })}
        {hidden.size > 0 ? (
          <button
            type="button"
            onClick={() => setHidden(new Set())}
            className="rounded-md px-1.5 py-1 text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Tout afficher
          </button>
        ) : null}
      </div>

      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Départ {money.format(opening)}
        {carryOver !== 0 && previousMonthLabel
          ? ` · report simulé ${fromMonth(previousMonthLabel)} ${money.format(carryOver)}`
          : null}{" "}
        · fin de mois enregistré {money.format(last.recorded)} · échéances du mois{" "}
        {money.format(last.echeances)} · simulé cumulé {money.format(last.simulated)}. Point
        le plus bas du simulé cumulé {money.format(lowPoint.simulated)} le {lowPoint.label}{" "}
        (jour {lowPoint.day}).
      </p>
    </div>
  );
}
