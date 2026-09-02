import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { type KnowledgeSpace } from '../db/schema/knowledge-spaces';
import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import {
  KnowledgeSpaceLocalResolver,
  type KnowledgeSpaceLocalResolverPort,
} from './knowledge-space.local-resolver';
import {
  decodeKnowledgeSpaceCursor,
  encodeKnowledgeSpaceCursor,
  type KnowledgeSpaceCursor,
} from './knowledge-space.cursor';
import {
  KnowledgeSpaceRepository,
  toKnowledgeSpaceApiProjection,
  toKnowledgeSpaceBindingProjection,
  type KnowledgeSpaceApiProjection,
  type KnowledgeSpaceBindingProjection,
} from './knowledge-space.repository';
import { normalizeKnowledgeSpaceName } from './knowledge-space-name';

export const KNOWLEDGE_SPACE_DEFAULT_LIMIT = 50;
export const KNOWLEDGE_SPACE_MAX_LIMIT = 100;

function validateKnowledgeSpaceListLimit(limit: number | undefined): number {
  const resolved = limit ?? KNOWLEDGE_SPACE_DEFAULT_LIMIT;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    resolved > KNOWLEDGE_SPACE_MAX_LIMIT
  ) {
    throw new Error('Knowledge Space list limit is invalid');
  }
  return resolved;
}

/** `rows` carries one extra row past the page limit (see
 *  `listForOwnerPage`'s `limit + 1`) purely to signal whether a further page
 *  exists — a longer `rows` than `page`, not `page`'s own length, is what a
 *  `nextCursor` is built from. */
function nextKnowledgeSpaceCursor(
  rows: Array<KnowledgeSpace>,
  page: Array<KnowledgeSpace>,
): string | null {
  if (rows.length <= page.length) return null;
  const last = page.at(-1);
  if (last === undefined) return null;
  return encodeKnowledgeSpaceCursor({
    createdAt: last.createdAt,
    id: last.knowledgeSpaceId,
  });
}

/** The HTTP and owner-scoped management capability exposed by this service. */
export type KnowledgeSpaceManagement = Pick<
  KnowledgeSpaceService,
  'provisionForOwner' | 'listForOwner' | 'getForOwner' | 'renameForOwner'
>;

/** Trusted worker-side binding resolution, never an HTTP response shape. */
export type KnowledgeSpaceBindingResolver = Pick<
  KnowledgeSpaceService,
  'resolveBindingForOwner' | 'resolveBindingForOwnerById' | 'listForOwnerPage'
>;

@Injectable()
export class KnowledgeSpaceService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(KnowledgeSpaceLocalResolver)
    private readonly localResolver: KnowledgeSpaceLocalResolverPort,
  ) {}

  /**
   * Provisioning is deliberately directory-first. A database error after the
   * child exists leaves an inert empty orphan; no recovery deletion is safe.
   */
  async provisionForOwner(
    ownerUserId: string,
    input?: { name: string },
  ): Promise<KnowledgeSpaceApiProjection> {
    const name = normalizeKnowledgeSpaceName(input?.name ?? 'Personal');
    const canonicalRoot = this.localResolver.resolveRoot();

    // Existing non-HTTP workers still call the former singleton helper without
    // a name. Keep that compatibility path anchored to the earliest row and
    // repair its child, while named HTTP creation stays non-idempotent.
    if (input === undefined) {
      const existing = await this.tenantDb.runAs(ownerUserId, (tx) =>
        new KnowledgeSpaceRepository(tx).findForOwnerForBinding(ownerUserId),
      );
      if (existing !== undefined) {
        this.localResolver.ensureChild(
          canonicalRoot,
          existing.knowledgeSpaceId,
        );
        return toKnowledgeSpaceApiProjection(existing);
      }
    }

    const knowledgeSpaceId = randomUUID();
    this.localResolver.ensureChild(canonicalRoot, knowledgeSpaceId);

    const space = await this.tenantDb.runAs(ownerUserId, (tx) =>
      new KnowledgeSpaceRepository(tx).create({
        knowledgeSpaceId,
        ownerUserId,
        name,
      }),
    );
    return toKnowledgeSpaceApiProjection(space);
  }

  async listForOwner(
    ownerUserId: string,
    options: {
      limit?: number;
      after?: string;
    } = {},
  ): Promise<{
    items: Array<KnowledgeSpaceApiProjection>;
    nextCursor: string | null;
  }> {
    const limit = validateKnowledgeSpaceListLimit(options.limit);
    const after =
      options.after === undefined
        ? undefined
        : decodeKnowledgeSpaceCursor(options.after);
    const rows = await this.tenantDb.runAs(ownerUserId, (tx) =>
      new KnowledgeSpaceRepository(tx).listForOwnerPage(
        ownerUserId,
        limit,
        after,
      ),
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map(toKnowledgeSpaceApiProjection),
      nextCursor: nextKnowledgeSpaceCursor(rows, page),
    };
  }

  async getForOwner(
    ownerUserId: string,
    knowledgeSpaceId: string,
  ): Promise<KnowledgeSpaceApiProjection | undefined> {
    const space = await this.tenantDb.runAs(ownerUserId, (tx) =>
      new KnowledgeSpaceRepository(tx).findByIdForOwner(
        knowledgeSpaceId,
        ownerUserId,
      ),
    );
    return space === undefined
      ? undefined
      : toKnowledgeSpaceApiProjection(space);
  }

  async renameForOwner(
    ownerUserId: string,
    knowledgeSpaceId: string,
    input: { name: string },
  ): Promise<KnowledgeSpaceApiProjection | undefined> {
    const name = normalizeKnowledgeSpaceName(input.name);
    const space = await this.tenantDb.runAs(ownerUserId, (tx) =>
      new KnowledgeSpaceRepository(tx).updateName(
        knowledgeSpaceId,
        ownerUserId,
        name,
      ),
    );
    return space === undefined
      ? undefined
      : toKnowledgeSpaceApiProjection(space);
  }

  /**
   * Temporary singleton binding compatibility: select the earliest owned row,
   * with the ID tie-breaker matching the inventory order.
   */
  async resolveBindingForOwner(
    ownerUserId: string,
  ): Promise<KnowledgeSpaceBindingProjection | undefined> {
    const space = await this.tenantDb.runAs(ownerUserId, (tx) =>
      new KnowledgeSpaceRepository(tx).findForOwnerForBinding(ownerUserId),
    );
    if (space === undefined) return undefined;

    const canonicalRoot = this.localResolver.resolveRoot();
    const directory = this.localResolver.resolveChild(
      canonicalRoot,
      space.knowledgeSpaceId,
    );
    return toKnowledgeSpaceBindingProjection(space, canonicalRoot, directory);
  }

  /** Resolve one current owner-owned binding immediately before a tool opens it. */
  async resolveBindingForOwnerById(
    ownerUserId: string,
    knowledgeSpaceId: string,
  ): Promise<KnowledgeSpaceBindingProjection | undefined> {
    const space = await this.tenantDb.runAs(ownerUserId, (tx) =>
      new KnowledgeSpaceRepository(tx).findByIdForOwner(
        knowledgeSpaceId,
        ownerUserId,
      ),
    );
    if (space === undefined) return undefined;

    const canonicalRoot = this.localResolver.resolveRoot();
    const directory = this.localResolver.resolveChild(
      canonicalRoot,
      space.knowledgeSpaceId,
    );
    return toKnowledgeSpaceBindingProjection(space, canonicalRoot, directory);
  }

  /** Worker/tool helper for a page of current owner rows without API DTOs. */
  async listForOwnerPage(
    ownerUserId: string,
    limit: number,
    after?: KnowledgeSpaceCursor,
  ) {
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      new KnowledgeSpaceRepository(tx).listForOwnerPage(
        ownerUserId,
        limit,
        after,
      ),
    );
  }
}
