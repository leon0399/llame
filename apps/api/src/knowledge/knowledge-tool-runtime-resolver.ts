import { Inject, Injectable } from '@nestjs/common';

import {
  KnowledgeFilesystemAdapter,
  type KnowledgeFilesystemBinding,
} from './knowledge-filesystem';
import {
  KnowledgeSpaceService,
  type KnowledgeSpaceBindingResolver,
} from './knowledge-space.service';
import { type KnowledgeToolResolver } from '../tools/types';

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

  createAdapter(binding: KnowledgeFilesystemBinding) {
    return new KnowledgeFilesystemAdapter(binding);
  }
}
