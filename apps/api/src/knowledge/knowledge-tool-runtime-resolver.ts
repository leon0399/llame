import { Inject, Injectable } from '@nestjs/common';

import {
  KnowledgeFilesystemAdapter,
  type KnowledgeFilesystemBinding,
} from './knowledge-filesystem';
import {
  KnowledgeSpaceService,
  KNOWLEDGE_SPACE_MAX_LIMIT,
  type KnowledgeSpaceBindingResolver,
} from './knowledge-space.service';
import {
  type KnowledgeToolResolver,
  type KnowledgeToolSpacePage,
} from '../tools/types';
import { type KnowledgeSpaceCursor } from './knowledge-space.cursor';

/**
 * Trusted worker-side Knowledge capability. Binding resolution remains owned
 * by KnowledgeSpaceService; this adapter factory never provisions directories.
 */
@Injectable()
export class KnowledgeToolRuntimeResolver implements KnowledgeToolResolver {
  constructor(
    @Inject(KnowledgeSpaceService)
    private readonly knowledgeSpaces: KnowledgeSpaceBindingResolver,
  ) {}

  resolveBindingForOwner(ownerUserId: string) {
    return this.knowledgeSpaces.resolveBindingForOwner(ownerUserId);
  }

  resolveBindingForOwnerById(ownerUserId: string, knowledgeSpaceId: string) {
    return this.knowledgeSpaces.resolveBindingForOwnerById(
      ownerUserId,
      knowledgeSpaceId,
    );
  }

  async listForOwnerPage(
    ownerUserId: string,
    after?: KnowledgeSpaceCursor,
  ): Promise<KnowledgeToolSpacePage> {
    const rows = await this.knowledgeSpaces.listForOwnerPage(
      ownerUserId,
      KNOWLEDGE_SPACE_MAX_LIMIT,
      after,
    );
    const spaces = rows.slice(0, KNOWLEDGE_SPACE_MAX_LIMIT).map((row) => ({
      id: row.knowledgeSpaceId,
      name: row.name,
      createdAt: row.createdAt,
    }));
    const last = spaces.at(-1);
    const page: KnowledgeToolSpacePage = { spaces };
    if (rows.length > KNOWLEDGE_SPACE_MAX_LIMIT && last !== undefined) {
      return {
        ...page,
        nextCursor: { createdAt: last.createdAt, id: last.id },
      };
    }
    return page;
  }

  createAdapter(binding: KnowledgeFilesystemBinding) {
    return new KnowledgeFilesystemAdapter(binding);
  }
}
