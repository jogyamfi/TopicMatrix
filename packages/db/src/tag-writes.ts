import type { Db } from './db.js';
import { createTagRepository } from './repositories/tag.js';

/** Deletes a tag together with its topic attachments, in one UnitOfWork. */
export function deleteTag(db: Db, userId: string, tagId: string): Promise<void> {
  return db.unitOfWork.run((tx) => createTagRepository(tx).delete(userId, tagId));
}
