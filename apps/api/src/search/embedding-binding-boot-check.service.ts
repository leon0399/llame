import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { TenantDbService } from '../db/tenant-db.service';
import {
  type InstanceConfigReader,
  InstanceConfigService,
} from '../instance-config/instance-config.service';
import {
  findEmbeddingBinding,
  listUndeclaredBindingKeys,
} from './embedding-binding-ledger';
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
 *
 * Also warns (non-fatal, chat-search-embeddings/operations layer 7, task
 * 7.3) for any ledger key that is no longer declared: undeclaring a model
 * leaves its vectors unread and undeleted by design — nothing queries an
 * arbitrary undeclared key, and only the `prune` operator command removes
 * them — so a silent config edit that stops embedding a whole corpus would
 * otherwise have no visible signal at all. Runs only when at least one model
 * IS still declared, preserving the zero-query contract above for the
 * genuinely off case.
 */
@Injectable()
export class EmbeddingBindingBootCheckService
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(EmbeddingBindingBootCheckService.name);

  constructor(
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    private readonly tenantDb: TenantDbService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const models = this.instanceConfig.config.embeddingModels;

    // Consistency only means something for a DECLARED model, so it stays
    // gated. The undeclared-key warning below deliberately is not: emptying
    // `embeddingModels[]` is the most likely way to end up with orphaned
    // vectors, and returning early here silenced the one message that tells
    // an operator to run `search:prune` in exactly that case.
    if (models.length > 0) {
      const ledger: EmbeddingBindingLookup = {
        findBinding: (modelKey) =>
          this.tenantDb.runAsPublic((tx) => findEmbeddingBinding(tx, modelKey)),
      };
      await assertDeclaredBindingsConsistent(models, ledger);
    }

    const declaredKeys = models.map((model) => model.id);
    const undeclared = await this.tenantDb.runAsPublic((tx) =>
      listUndeclaredBindingKeys(tx, declaredKeys),
    );
    for (const key of undeclared) {
      this.logger.warn(
        `Embedding model "${key}" has stored vectors but is no longer declared in embeddingModels[] — they are left unread and undeleted; run the 'search:prune' operator command to remove them.`,
      );
    }
  }
}
