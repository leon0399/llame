/**
 * Knowledge Space persistence and projection boundaries.
 *
 * PostgreSQL stores only tenant-owned authority metadata. Filesystem roots and
 * stable-ID child paths are local bindings and never enter these projections.
 */

import { and, asc, eq, gt, or } from 'drizzle-orm';

import { users } from '../db/schema/auth';
import {
  knowledgeSpaces,
  type KnowledgeSpace,
} from '../db/schema/knowledge-spaces';
import { type Db } from '../db/tenant-db.service';
import type { KnowledgeSpaceCursor } from './knowledge-space.cursor';

export type KnowledgeSpaceLogicalProjection = {
  id: string;
};

export type KnowledgeSpaceApiProjection = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

export type KnowledgeSpaceBindingProjection = {
  id: string;
  name: string;
  root: string;
  directory: string;
};

export function toKnowledgeSpaceLogicalProjection(
  space: Pick<KnowledgeSpace, 'knowledgeSpaceId'>,
): KnowledgeSpaceLogicalProjection {
  return { id: space.knowledgeSpaceId };
}

export function toKnowledgeSpaceApiProjection(
  space: Pick<
    KnowledgeSpace,
    'knowledgeSpaceId' | 'name' | 'createdAt' | 'updatedAt'
  >,
): KnowledgeSpaceApiProjection {
  return {
    id: space.knowledgeSpaceId,
    name: space.name,
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
  };
}

export function toKnowledgeSpaceBindingProjection(
  space: Pick<KnowledgeSpace, 'knowledgeSpaceId' | 'name'>,
  root: string,
  directory: string,
): KnowledgeSpaceBindingProjection {
  return {
    id: space.knowledgeSpaceId,
    name: space.name,
    root,
    directory,
  };
}

export class KnowledgeSpaceRepository {
  constructor(private readonly db: Db) {}

  /**
   * Deterministic compatibility lookup for existing binding callers. New
   * callers should use findByIdForOwner or listForOwnerPage instead.
   */
  async findForOwner(ownerUserId: string): Promise<KnowledgeSpace | undefined> {
    const [row] = await this.db
      .select()
      .from(knowledgeSpaces)
      .where(eq(knowledgeSpaces.ownerUserId, ownerUserId))
      .orderBy(
        asc(knowledgeSpaces.createdAt),
        asc(knowledgeSpaces.knowledgeSpaceId),
      )
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
      .orderBy(
        asc(knowledgeSpaces.createdAt),
        asc(knowledgeSpaces.knowledgeSpaceId),
      )
      // Binding-time reads must serialize with a concurrent revoke/update.
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

  async findByIdForOwner(
    knowledgeSpaceId: string,
    ownerUserId: string,
  ): Promise<KnowledgeSpace | undefined> {
    const [row] = await this.db
      .select()
      .from(knowledgeSpaces)
      .where(
        and(
          eq(knowledgeSpaces.knowledgeSpaceId, knowledgeSpaceId),
          eq(knowledgeSpaces.ownerUserId, ownerUserId),
        ),
      )
      .limit(1);
    return row;
  }

  /**
   * Returns at most `limit + 1` rows. The extra row lets the service produce a
   * next cursor without counting or materializing an uncapped inventory.
   */
  async listForOwnerPage(
    ownerUserId: string,
    limit: number,
    after?: KnowledgeSpaceCursor,
  ): Promise<Array<KnowledgeSpace>> {
    const conditions = [eq(knowledgeSpaces.ownerUserId, ownerUserId)];
    if (after !== undefined) {
      conditions.push(
        or(
          gt(knowledgeSpaces.createdAt, after.createdAt),
          and(
            eq(knowledgeSpaces.createdAt, after.createdAt),
            gt(knowledgeSpaces.knowledgeSpaceId, after.id),
          ),
        )!,
      );
    }

    return this.db
      .select()
      .from(knowledgeSpaces)
      .where(and(...conditions))
      .orderBy(
        asc(knowledgeSpaces.createdAt),
        asc(knowledgeSpaces.knowledgeSpaceId),
      )
      .limit(limit + 1);
  }

  async create(input: {
    knowledgeSpaceId: string;
    ownerUserId: string;
    name: string;
  }): Promise<KnowledgeSpace> {
    const [created] = await this.db
      .insert(knowledgeSpaces)
      .values(input)
      .returning();
    if (created === undefined) {
      throw new Error('Knowledge Space was not created');
    }
    return created;
  }

  async updateName(
    knowledgeSpaceId: string,
    ownerUserId: string,
    name: string,
  ): Promise<KnowledgeSpace | undefined> {
    const [updated] = await this.db
      .update(knowledgeSpaces)
      .set({ name, updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeSpaces.knowledgeSpaceId, knowledgeSpaceId),
          eq(knowledgeSpaces.ownerUserId, ownerUserId),
        ),
      )
      .returning();
    return updated;
  }
}
