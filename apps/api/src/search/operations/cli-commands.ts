/**
 * `search:*` operator command logic (chat-search-embeddings/operations,
 * layer 7) — split out of `cli.ts` so this module has no top-level
 * executing script. `cli.ts` reads `process.argv` and calls `process.exit`
 * as soon as it is imported (script, not library), which makes it unsafe to
 * import from a test: importing it would run `runCommand` against whatever
 * argv the test process happens to have and could terminate the worker. This
 * file holds every piece worth proving directly — argument-driven command
 * dispatch, the shared failure-reporting helpers, and each command's
 * wiring/formatting — with no import-time side effect, mirroring
 * `owner-write.ts`'s "split for testability along an existing fault line"
 * rationale rather than introducing a new one.
 *
 * `tenantDb`/`instanceConfig` parameters below are narrowed to the Pick<>
 * shape each command actually calls (#268 "narrow the dependency, not the
 * fake") — the same narrowing `prune.ts`/`retry-failed.ts`/
 * `coverage-report.ts`/`discovery-provisioning.ts` already apply one layer
 * down. The real `TenantDbService`/`InstanceConfigService` satisfy these
 * automatically; a test can supply a plain structural fake without a cast.
 */
import { type TenantDbService } from '../../db/tenant-db.service';
import { type InstanceConfigReader } from '../../instance-config/instance-config.service';
import { assertDiscoveryFunctionProvisioned } from '../discovery-provisioning';
import { CHUNKER_VERSION } from '../chat/conversation-chunker';
import { EMBED_INPUT_VERSION } from '../embed-input-version';
import { runBackfill } from './backfill';
import { getEmbeddingCoverageReport } from './coverage-report';
import { getProjectionCoverageReport } from './projection-coverage';
import { type OwnerWriteFailure } from './owner-write';
import { pruneUndeclaredModelVectors } from './prune';
import { retryFailedDocuments } from './retry-failed';
import { type StrictChatEmbedDispatcher } from '../search-embed-dispatch.service';

/** Display cap for the `coverage` readout — a report, not a worklist, so a
 *  much smaller bound than backfill's is appropriate; a corpus larger than
 *  this needs the report re-run after acting on the shown chats. */
export const COVERAGE_REPORT_MAX_ROWS = 5000;

/** The corpus's declared model, or a clear operator-facing error — every
 *  command below except `prune` needs one. */
export function requireEmbeddingModelId(
  instanceConfig: InstanceConfigReader,
): string {
  const modelId = instanceConfig.config.search.chats.embeddingModelId;
  if (!modelId) {
    throw new Error(
      'search.chats.embeddingModelId is not configured — nothing to backfill/retry/report against. Set it in llame.config.json first.',
    );
  }
  return modelId;
}

/**
 * `prune`/`retry-failed` shared failure reporting (efficiency-pass addendum
 * to the review findings above): `forEachOwner` now runs bounded-concurrent,
 * so a single owner's write can reject independently of the rest — this
 * must still fail the command loudly, exactly like `backfill`'s enqueue
 * failures above, not quietly report a lower count. Throws when `failures`
 * is non-empty; a no-op otherwise.
 */
export function failIfAnyOwnerFailed(
  command: string,
  failures: ReadonlyArray<OwnerWriteFailure>,
): void {
  if (failures.length === 0) return;
  for (const failure of failures) {
    console.error(
      `${command}: failed for owner ${failure.ownerId}: ${failure.message}`,
    );
  }
  throw new Error(
    `${command}: FAILED for ${failures.length} owner(s) — see errors above. Safe to re-run; an owner that already succeeded simply affects zero rows the second time.`,
  );
}

export async function runBackfillCommand(
  dispatch: StrictChatEmbedDispatcher,
  tenantDb: Pick<TenantDbService, 'runAsPublic'>,
  instanceConfig: InstanceConfigReader,
): Promise<void> {
  const modelId = requireEmbeddingModelId(instanceConfig);
  // Read-path fail-loud check (review finding): without this, an
  // unprovisioned `app_rls` role makes llame_search_embedding_coverage
  // silently return zero rows, and this command would print "enqueued
  // 0 chat(s)" — a wrong answer, indistinguishable from a genuinely
  // covered corpus.
  await assertDiscoveryFunctionProvisioned(
    tenantDb,
    'llame_search_embedding_coverage',
  );
  const { enqueued, coalesced, failures } = await runBackfill(
    tenantDb,
    dispatch,
    modelId,
    EMBED_INPUT_VERSION,
  );
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(
        `backfill: failed to enqueue chat ${failure.chatId} (owner ${failure.ownerUserId}): ${failure.message}`,
      );
    }
    throw new Error(
      `backfill: enqueued ${enqueued} chat(s), FAILED to enqueue ${failures.length} — see errors above. Safe to re-run once the queue is reachable again (an already-queued chat coalesces under its singleton key rather than duplicating).`,
    );
  }
  console.log(
    `backfill: enqueued ${enqueued} chat(s)` +
      (coalesced > 0
        ? `, ${coalesced} already queued (coalesced, not re-enqueued)`
        : ''),
  );
}

export async function runPruneCommand(
  tenantDb: Pick<TenantDbService, 'runAs' | 'runAsPublic'>,
  instanceConfig: InstanceConfigReader,
): Promise<void> {
  const declaredModelKeys = instanceConfig.config.embeddingModels.map(
    (model) => model.id,
  );
  const { prunedDocuments, affectedOwners, retiredBindings, failures } =
    await pruneUndeclaredModelVectors(tenantDb, declaredModelKeys);
  failIfAnyOwnerFailed('prune', failures);
  console.log(
    `prune: cleared ${prunedDocuments} document(s) across ${affectedOwners} owner(s), retired ${retiredBindings} ledger key(s)`,
  );
}

export async function runRetryFailedCommand(
  tenantDb: Pick<TenantDbService, 'runAs' | 'runAsPublic'>,
  instanceConfig: InstanceConfigReader,
): Promise<void> {
  const modelId = requireEmbeddingModelId(instanceConfig);
  const { clearedDocuments, affectedOwners, failures } =
    await retryFailedDocuments(tenantDb, modelId, EMBED_INPUT_VERSION);
  failIfAnyOwnerFailed('retry-failed', failures);
  console.log(
    `retry-failed: reset ${clearedDocuments} document(s) across ${affectedOwners} owner(s) — run 'backfill' (or wait for the sweep) to re-embed them`,
  );
}

export async function runCoverageCommand(
  tenantDb: Pick<TenantDbService, 'runAsPublic'>,
  instanceConfig: InstanceConfigReader,
): Promise<void> {
  const modelId = requireEmbeddingModelId(instanceConfig);
  // Same fail-loud provisioning check as backfill above, against the report
  // function this readout actually reads.
  await assertDiscoveryFunctionProvisioned(
    tenantDb,
    'llame_search_embedding_report',
  );
  const rows = await getEmbeddingCoverageReport(
    tenantDb,
    modelId,
    EMBED_INPUT_VERSION,
    COVERAGE_REPORT_MAX_ROWS,
  );
  if (rows.length === 0) {
    console.log('coverage: no chat has outstanding or failed work');
    return;
  }
  console.log(
    'chat_id'.padEnd(38) +
      'owner_user_id'.padEnd(38) +
      'embedded'.padEnd(10) +
      'failed'.padEnd(10) +
      'outstanding',
  );
  for (const row of rows) {
    console.log(
      row.chatId.padEnd(38) +
        row.ownerUserId.padEnd(38) +
        String(row.embedded).padEnd(10) +
        String(row.failed).padEnd(10) +
        String(row.outstanding),
    );
  }
}

export async function runProjectionCoverageCommand(
  tenantDb: Pick<TenantDbService, 'runAsPublic'>,
): Promise<void> {
  await assertDiscoveryFunctionProvisioned(
    tenantDb,
    'llame_search_projection_coverage_v2',
  );
  const report = await getProjectionCoverageReport(tenantDb, CHUNKER_VERSION);
  console.log(
    `projection-coverage: chunker_version=${report.chunkerVersion} ` +
      `chats=${report.chatCount} ready=${report.readyChatCount} ` +
      `stale=${report.staleChatCount} documents=${report.documentCount} ` +
      `complete_documents=${report.completeDocumentCount}`,
  );
}

/** Already-resolved command dependencies (#268 "narrow the dependency, not
 *  the fake") — `cli.ts` resolves these once from the real Nest app context
 *  it owns and passes them in, so this dispatcher never touches DI directly
 *  and a test can supply a plain object literal with no `INestApplicationContext`
 *  to fake. Resolving `dispatch` unconditionally is harmless: `OperationsModule`
 *  already provides `SearchEmbedDispatchService` as a singleton regardless of
 *  which command runs (see that module's own doc comment). */
export type CommandDeps = {
  tenantDb: Pick<TenantDbService, 'runAs' | 'runAsPublic'>;
  instanceConfig: InstanceConfigReader;
  dispatch: StrictChatEmbedDispatcher;
};

export async function runCommand(
  command: string,
  { tenantDb, instanceConfig, dispatch }: CommandDeps,
): Promise<void> {
  switch (command) {
    case 'backfill':
      return await runBackfillCommand(dispatch, tenantDb, instanceConfig);
    case 'prune':
      return await runPruneCommand(tenantDb, instanceConfig);
    case 'retry-failed':
      return await runRetryFailedCommand(tenantDb, instanceConfig);
    case 'coverage':
      return await runCoverageCommand(tenantDb, instanceConfig);
    case 'projection-coverage':
      return await runProjectionCoverageCommand(tenantDb);
    default:
      throw new Error(
        `Unknown command "${command}" — expected one of: backfill, prune, retry-failed, coverage, projection-coverage`,
      );
  }
}
