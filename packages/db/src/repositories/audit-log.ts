import type { AuditLog, PrismaClientOrTx } from '../types.js';

export interface CreateAuditLogInput {
  actorId?: string;
  action: string;
  targetId?: string;
  /** Small JSON string. Never credentials or anything beyond ids (§11.2 A09). */
  metadata?: string;
}

export interface AuditLogRepository {
  create(input: CreateAuditLogInput): Promise<AuditLog>;
}

export function createAuditLogRepository(client: PrismaClientOrTx): AuditLogRepository {
  return {
    create: (input) => client.auditLog.create({ data: input }),
  };
}
