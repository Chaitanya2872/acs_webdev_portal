import { Database, Queryable } from '../../db/database';

export type AuditActor = { id: number | null; label: string; ip?: string | null };

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  details?: Record<string, unknown>;
};

export const systemActor = (label = 'system'): AuditActor => ({ id: null, label });

export class AuditService {
  constructor(private readonly db: Database) {}

  /** Records an audit entry; pass the transaction so the entry commits (or rolls back) with the change it describes. */
  async record(actor: AuditActor, entry: AuditEntry, executor: Queryable = this.db): Promise<void> {
    await executor.query(
      `INSERT INTO audit_logs (actor_user_id, actor_label, action, entity_type, entity_id, details, ip)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        actor.id,
        actor.label,
        entry.action,
        entry.entityType,
        entry.entityId == null ? null : String(entry.entityId),
        JSON.stringify(entry.details ?? {}),
        actor.ip ?? null,
      ],
    );
  }

  async list(filter: { entityType?: string; entityId?: string; limit?: number }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.entityType) {
      params.push(filter.entityType);
      conditions.push(`entity_type = $${params.length}`);
    }
    if (filter.entityId) {
      params.push(filter.entityId);
      conditions.push(`entity_id = $${params.length}`);
    }
    params.push(Math.min(Math.max(filter.limit ?? 100, 1), 500));
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.db.query<{
      id: string;
      actor_user_id: number | null;
      actor_label: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      details: Record<string, unknown>;
      ip: string | null;
      created_at: Date;
    }>(`SELECT id::text, actor_user_id, actor_label, action, entity_type, entity_id, details, ip, created_at
        FROM audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`, params);

    return result.rows.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      actor: row.actor_label,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      details: row.details,
      ip: row.ip,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
}
