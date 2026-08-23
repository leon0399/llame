/**
 * `search:*` operator commands (chat-search-embeddings/operations, layer 7)
 * — the deliberate, operator-initiated half of chat search embedding
 * maintenance; the layer below ships the worker, queue, backlog sweep, and
 * ledger gate that run automatically.
 *
 * There is no CLI framework in this repo. Operator entry points are
 * `package.json` scripts, in one of two existing shapes: `db:provision-rls`
 * (a `.sql` file piped into `psql`, no application code) or `db:migrate`
 * (`npx tsx src/db/migrate.ts`, a TypeScript entrypoint run directly).
 * `prune`/`retry-failed`/`coverage` are bounded SQL with no provider
 * involvement, so either shape would work for them alone — but `backfill`
 * needs the application's queue wiring (`SearchEmbedDispatchService`,
 * pg-boss) to enqueue, which only a TypeScript entrypoint can reach. Rather
 * than splitting the four operator commands across two different shapes,
 * this follows `db:migrate`'s: one `tsx` entrypoint, subcommand-dispatched,
 * reusing `worker.ts`'s `NestFactory.createApplicationContext(...)` pattern
 * (via `OperationsModule` — see its own doc comment for why it is NOT
 * `SearchModule`/`WorkerModule`) rather than standing up a second wiring
 * path.
 *
 * Usage: `npx tsx src/search/operations/cli.ts <backfill|prune|retry-failed|coverage>`
 * (wired as `pnpm --filter api search:backfill` etc. — see package.json).
 */
import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';

import { TenantDbService } from '../../db/tenant-db.service';
import { InstanceConfigService } from '../../instance-config/instance-config.service';
import { assertDiscoveryFunctionProvisioned } from '../discovery-provisioning';
import { EMBED_INPUT_VERSION } from '../search-embed.worker';
import { runBackfill } from './backfill';
import { getEmbeddingCoverageReport } from './coverage-report';
import { OperationsModule } from './operations.module';
import { pruneUndeclaredModelVectors } from './prune';
import { retryFailedDocuments } from './retry-failed';
import { SearchEmbedDispatchService } from '../search-embed-dispatch.service';

config({ path: '.env.local' });

/** Display cap for the `coverage` readout — a report, not a worklist, so a
 *  much smaller bound than backfill's is appropriate; a corpus larger than
 *  this needs the report re-run after acting on the shown chats. */
const COVERAGE_REPORT_MAX_ROWS = 5000;

/** The corpus's declared model, or a clear operator-facing error — every
 *  command below except `prune` needs one. */
function requireEmbeddingModelId(
  instanceConfig: InstanceConfigService,
): string {
  const modelId = instanceConfig.config.search.chats.embeddingModelId;
  if (!modelId) {
    throw new Error(
      'search.chats.embeddingModelId is not configured — nothing to backfill/retry/report against. Set it in llame.config.json first.',
    );
  }
  return modelId;
}

async function runCommand(command: string): Promise<void> {
  const app = await NestFactory.createApplicationContext(OperationsModule);
  try {
    const tenantDb = app.get(TenantDbService);
    const instanceConfig = app.get(InstanceConfigService);

    switch (command) {
      case 'backfill': {
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
        const dispatch = app.get(SearchEmbedDispatchService);
        const { enqueued, failures } = await runBackfill(
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
        console.log(`backfill: enqueued ${enqueued} chat(s)`);
        return;
      }
      case 'prune': {
        const declaredModelKeys = instanceConfig.config.embeddingModels.map(
          (model) => model.id,
        );
        const { prunedDocuments, affectedOwners, retiredBindings } =
          await pruneUndeclaredModelVectors(tenantDb, declaredModelKeys);
        console.log(
          `prune: cleared ${prunedDocuments} document(s) across ${affectedOwners} owner(s), retired ${retiredBindings} ledger key(s)`,
        );
        return;
      }
      case 'retry-failed': {
        const modelId = requireEmbeddingModelId(instanceConfig);
        const { clearedDocuments, affectedOwners } = await retryFailedDocuments(
          tenantDb,
          modelId,
          EMBED_INPUT_VERSION,
        );
        console.log(
          `retry-failed: reset ${clearedDocuments} document(s) across ${affectedOwners} owner(s) — run 'backfill' (or wait for the sweep) to re-embed them`,
        );
        return;
      }
      case 'coverage': {
        const modelId = requireEmbeddingModelId(instanceConfig);
        // Same fail-loud provisioning check as backfill above, against the
        // report function this readout actually reads.
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
        return;
      }
      default:
        throw new Error(
          `Unknown command "${command}" — expected one of: backfill, prune, retry-failed, coverage`,
        );
    }
  } finally {
    // Log-and-swallow, not rethrow: a close-time error (e.g. a queue
    // connection already gone) must never overturn a command that already
    // printed its own success line above — a rethrow here would reach the
    // outer .catch and report `❌ search:${command} failed` with exit code 1
    // for a command that, in fact, succeeded.
    await app.close().catch((error: unknown) => {
      console.error(
        'Warning: error while closing the application context',
        error,
      );
    });
  }
}

const command = process.argv[2];
if (!command) {
  console.error(
    'Usage: tsx src/search/operations/cli.ts <backfill|prune|retry-failed|coverage>',
  );
  process.exit(1);
}

runCommand(command)
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`❌ search:${command} failed`);
    console.error(err);
    process.exit(1);
  });
