import type { SqlExecutor } from "./db.ts";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Records a privileged action. Never include secrets or credentials in
 * metadata. Failures to audit must surface, not be swallowed.
 */
export async function logAudit(
  db: SqlExecutor,
  entry: AuditEntry,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      entry.actorId,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}
