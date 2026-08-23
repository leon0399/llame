import { Inject, Injectable } from '@nestjs/common';

import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import {
  KnowledgeSpaceLocalResolver,
  type KnowledgeSpaceLocalResolverPort,
} from './knowledge-space.local-resolver';
import {
  KnowledgeSpaceRepository,
  toKnowledgeSpaceLogicalProjection,
  toKnowledgeSpaceBindingProjection,
  type KnowledgeSpaceBindingProjection,
  type KnowledgeSpaceLogicalProjection,
} from './knowledge-space.repository';

/** The HTTP-safe capability exposed by this service. */
export type KnowledgeSpaceProvisioner = Pick<
  KnowledgeSpaceService,
  'provisionForOwner'
>;

/** Trusted worker-side binding resolution, never an HTTP response shape. */
export type KnowledgeSpaceBindingResolver = Pick<
  KnowledgeSpaceService,
  'resolveBindingForOwner'
>;

@Injectable()
export class KnowledgeSpaceService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(KnowledgeSpaceLocalResolver)
    private readonly localResolver: KnowledgeSpaceLocalResolverPort,
  ) {}

  async provisionForOwner(
    ownerUserId: string,
  ): Promise<KnowledgeSpaceLogicalProjection> {
    // Root validation must happen before the row transaction. Once a row is
    // committed, a later filesystem failure intentionally leaves that ID as
    // the retry anchor.
    const canonicalRoot = this.localResolver.resolveRoot();
    const space = await this.tenantDb.runAs(ownerUserId, (tx) =>
      new KnowledgeSpaceRepository(tx).createOrGet(ownerUserId),
    );

    this.localResolver.ensureChild(canonicalRoot, space.knowledgeSpaceId);
    return toKnowledgeSpaceLogicalProjection(space);
  }

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
}
