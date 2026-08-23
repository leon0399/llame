import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { TenantDbService } from '../db/tenant-db.service';
import {
  type InstanceConfigReader,
  InstanceConfigService,
} from '../instance-config/instance-config.service';
import { findEmbeddingBinding } from './embedding-binding-ledger';
import {
  assertDeclaredBindingsConsistent,
  type EmbeddingBindingLookup,
} from './embedding-model-bindings';

/**
 * Boot-time enforcement of the binding-ledger check (chat-search-embeddings,
 * design D1) — the opposite posture from `SearchReindexWorker`'s discovery
 * self-check: THAT check is non-fatal (a backfill-only degradation); this one
 * THROWS, aborting Nest bootstrap, because a redefined-in-place key silently
 * mixes two embedding spaces under one name — exactly the failure the ledger
 * exists to turn into a startup failure instead.
 *
 * Registered as a plain provider on `SearchModule` (not exported — nothing
 * else injects it): `InstanceConfigService`/`TenantDbService` are both
 * `@Global`, so this needs no new module import, preserving the leaf-module
 * constraint (`SearchModule`'s `imports` stays `[QueueModule]`).
 *
 * Issues NO lookup at all when no embedding models are declared — part of
 * the off-by-default contract: a stock install boots clean with zero queries
 * against this table.
 */
@Injectable()
export class EmbeddingBindingBootCheckService
  implements OnApplicationBootstrap
{
  constructor(
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    private readonly tenantDb: TenantDbService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const models = this.instanceConfig.config.embeddingModels;
    if (models.length === 0) return;

    const ledger: EmbeddingBindingLookup = {
      findBinding: (modelKey) =>
        this.tenantDb.runAsPublic((tx) => findEmbeddingBinding(tx, modelKey)),
    };
    await assertDeclaredBindingsConsistent(models, ledger);
  }
}
