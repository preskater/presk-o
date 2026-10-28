import { getPrisma } from "@/lib/db";
import {
  redactAuditMetadata,
  type AuditAction,
  type AuditOutcome,
} from "./domain";

/**
 * Audit persistence (SO-02 / M18-02).
 *
 * There is no update and no delete: a row is written once, by the server, from a code
 * the server chose. Nothing in `src/` exposes a write to the browser, which is what
 * makes the trail append-only in practice rather than by convention.
 */

export type AuditEntryInput = {
  workspaceId: string;
  /** Signed-in user, or `null` for a job or a scheduler. */
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  outcome: AuditOutcome;
  /** Free-form on the way in; `redactAuditMetadata` decides what is actually kept. */
  metadata?: Record<string, unknown>;
};

/**
 * Writes one audit entry, scoped to its workspace.
 *
 * A failure propagates on purpose: the caller decides whether the action may proceed
 * unaudited. Exports treat it as fatal (see `serveCsvExport`), so a file never leaves
 * without its entry.
 */
export async function recordAuditEvent(input: AuditEntryInput): Promise<void> {
  await getPrisma().auditEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      outcome: input.outcome,
      metadata: redactAuditMetadata(input.metadata),
    },
    select: { id: true },
  });
}
