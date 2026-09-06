import type { AppDeps } from './deps.js';

export interface AuditEntry {
  actorId?: string;
  action: string;
  targetId?: string;
  /** No PII beyond ids, never credentials (§11.2 A09). */
  metadata?: Record<string, unknown>;
}

/**
 * Records an audit entry (auth success/failure, admin user-management actions, account
 * deletion — P2 task 12). Deliberately never lets a logging failure break the request it's
 * attached to; a broken audit write is logged and swallowed, not surfaced as a 500.
 */
export async function recordAudit(deps: AppDeps, entry: AuditEntry): Promise<void> {
  try {
    await deps.db.auditLogs.create({
      ...(entry.actorId !== undefined ? { actorId: entry.actorId } : {}),
      action: entry.action,
      ...(entry.targetId !== undefined ? { targetId: entry.targetId } : {}),
      ...(entry.metadata !== undefined ? { metadata: JSON.stringify(entry.metadata) } : {}),
    });
  } catch (err) {
    deps.logger.warn('audit_log_write_failed', {
      action: entry.action,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
