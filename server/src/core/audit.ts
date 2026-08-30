import { run } from "../db/connection.js";

export interface AuditParams {
  tenantId?: number | null;
  userId?: number | null;
  action: string;
  entityType?: string;
  entityId?: number | string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
  device?: string;
}

/** Append-only audit event. Never updated or deleted. */
export async function audit(p: AuditParams) {
  await run(
    `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, before, after, ip, device)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      p.tenantId ?? null,
      p.userId ?? null,
      p.action,
      p.entityType ?? null,
      p.entityId != null ? String(p.entityId) : null,
      p.before != null ? JSON.stringify(p.before) : null,
      p.after != null ? JSON.stringify(p.after) : null,
      p.ip ?? null,
      p.device ?? null
    ]
  );
}
