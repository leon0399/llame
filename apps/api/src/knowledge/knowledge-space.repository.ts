/**
 * Knowledge Space persistence and projection boundaries.
 *
 * The row is the durable tenant-owned identity anchor. Filesystem binding
 * details are never persisted here and are only assembled by trusted local
 * provisioning code.
 */

import { asc, eq } from 'drizzle-orm';

import { users } from '../db/schema/auth';
import {
  knowledgeSpaces,
  type KnowledgeSpace,
} from '../db/schema/knowledge-spaces';
import { type Db } from '../db/tenant-db.service';

export type KnowledgeSpaceLogicalProjection = {
  id: string;
};

export type KnowledgeSpaceBindingProjection = {
  id: string;
  root: string;
  directory: string;
};

export function toKnowledgeSpaceLogicalProjection(
  space: Pick<KnowledgeSpace, 'knowledgeSpaceId'>,
): KnowledgeSpaceLogicalProjection {
  return { id: space.knowledgeSpaceId };
}

export function toKnowledgeSpaceBindingProjection(
  space: Pick<KnowledgeSpace, 'knowledgeSpaceId'>,
  root: string,
  directory: string,
): KnowledgeSpaceBindingProjection {
  return {
    id: space.knowledgeSpaceId,
    root,
    directory,
  };
}

export class KnowledgeSpaceRepository {
  constructor(private readonly db: Db) {}

  async findForOwner(ownerUserId: string): Promise<KnowledgeSpace | undefined> {
    const [row] = await this.db
      .select()
      .from(knowledgeSpaces)
      .where(eq(knowledgeSpaces.ownerUserId, ownerUserId))
      .orderBy(asc(knowledgeSpaces.knowledgeSpaceId))
      .limit(1);
    return row;
  }

  async findForOwnerForBinding(
    ownerUserId: string,
  ): Promise<KnowledgeSpace | undefined> {
    const [row] = await this.db
      .select()
      .from(knowledgeSpaces)
      .where(eq(knowledgeSpaces.ownerUserId, ownerUserId))
      .orderBy(asc(knowledgeSpaces.knowledgeSpaceId))
      .for('share')
      .limit(1);
    return row;
  }

  async createOrGet(ownerUserId: string): Promise<KnowledgeSpace> {
    const [owner] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, ownerUserId))
      .for('update')
      .limit(1);
    if (owner === undefined) {
      throw new Error('Knowledge Space owner was not available');
    }

    const existing = await this.findForOwner(ownerUserId);
    if (existing !== undefined) {
      return existing;
    }

    const [created] = await this.db
      .insert(knowledgeSpaces)
      .values({
        knowledgeSpaceId: crypto.randomUUID(),
        ownerUserId,
      })
      .onConflictDoNothing()
      .returning();

    if (created !== undefined) {
      return created;
    }

    const conflicted = await this.findForOwner(ownerUserId);
    if (conflicted === undefined) {
      throw new Error('Knowledge Space owner row was not available');
    }
    return conflicted;
  }
}
