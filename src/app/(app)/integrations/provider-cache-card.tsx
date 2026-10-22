import { Badge, Card, EmptyState, TableShell, tdClass, thClass } from "@/components/ui";
import { formatInstant } from "@/lib/dates";
import { CACHE_MAX_AGE_DAYS, isCacheEntryExpired } from "@/modules/integrations/cache";
import type { ProviderCacheSummary } from "@/modules/integrations/repository";

const KIND_LABELS: Record<string, string> = {
  issues: "Issues et pull requests",
  milestones: "Jalons",
};

/**
 * Conditional request state (DA-04): when each per-repository resource was last
 * checked, and when its rows were last written from a full answer. A "checked" date
 * newer than the "changed" one means the provider confirmed nothing moved (304).
 */
export function ProviderCacheCard({
  entries,
  now,
}: {
  entries: ProviderCacheSummary[];
  now: Date;
}) {
  return (
    <Card
      title="Requêtes conditionnelles"
      collapsible
      defaultOpen={false}
      description={`« Vérifiée » : dernier contrôle réussi auprès du fournisseur. « Modifiée » : dernière écriture des données depuis une réponse complète. Au-delà de ${CACHE_MAX_AGE_DAYS} jours sans écriture, la ressource est relue en entier.`}
    >
      {entries.length === 0 ? (
        <EmptyState
          title="Aucune ressource en cache"
          description="Rien n'a encore été lu, ou le jeton vient d'être remplacé : la prochaine synchronisation lira tout en entier."
        />
      ) : (
        <TableShell caption="État des requêtes conditionnelles">
          <thead>
            <tr>
              <th scope="col" className={thClass}>Dépôt</th>
              <th scope="col" className={thClass}>Ressource</th>
              <th scope="col" className={thClass}>Vérifiée</th>
              <th scope="col" className={thClass}>Modifiée</th>
              <th scope="col" className={thClass}>État</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const expired = isCacheEntryExpired(entry, now);

              return (
                <tr key={entry.id}>
                  <td className={tdClass}>{entry.repository}</td>
                  <td className={tdClass}>{KIND_LABELS[entry.kind] ?? entry.kind}</td>
                  <td className={`${tdClass} whitespace-nowrap`}>{formatInstant(entry.checkedAt)}</td>
                  <td className={`${tdClass} whitespace-nowrap`}>{formatInstant(entry.changedAt)}</td>
                  <td className={tdClass}>
                    {expired ? (
                      <Badge tone="warning">Expirée — relue en entier au prochain passage</Badge>
                    ) : !entry.hasValidator ? (
                      <Badge tone="neutral">Sans validateur — toujours relue</Badge>
                    ) : entry.checkedAt > entry.changedAt ? (
                      <Badge tone="positive">Inchangée</Badge>
                    ) : (
                      <Badge tone="neutral">Mise à jour</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
    </Card>
  );
}
