import type { PrismaClientOrTx, User } from '../types.js';

export interface CreateUserInput {
  email: string;
  emailNormalised: string;
  passwordHash: string;
  displayName: string;
  role?: 'ADMIN' | 'LEARNER';
  mustChangePassword?: boolean;
}

export interface UpdateUserInput {
  displayName?: string;
  passwordHash?: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
}

/**
 * The User repository is the one exception to "every method takes userId first" (packages/db
 * conventions doc, delivery-plan.md P1): a user IS the owning identity, so `id` here already is
 * the scope. Every other repository takes `userId` first and never trusts a client-supplied id
 * alone.
 */
export interface UserRepository {
  count(): Promise<number>;
  create(input: CreateUserInput): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmailNormalised(emailNormalised: string): Promise<User | null>;
  update(id: string, patch: UpdateUserInput): Promise<User>;
  /** Admin user management (FR-1.8) — every user, newest first. */
  list(): Promise<User[]>;
}

export function createUserRepository(client: PrismaClientOrTx): UserRepository {
  return {
    count: () => client.user.count(),
    create: (input) =>
      client.user.create({
        data: {
          role: 'LEARNER',
          mustChangePassword: false,
          ...input,
        },
      }),
    findById: (id) => client.user.findUnique({ where: { id } }),
    findByEmailNormalised: (emailNormalised) =>
      client.user.findUnique({ where: { emailNormalised } }),
    update: (id, patch) => client.user.update({ where: { id }, data: patch }),
    list: () => client.user.findMany({ orderBy: { createdAt: 'desc' } }),
  };
}
