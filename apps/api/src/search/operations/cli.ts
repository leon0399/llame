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
 * This file is deliberately just the process shell: argv, the Nest app
 * context's lifecycle (create, resolve, close), and exit codes. It runs
 * `runCommand` as soon as it is imported, with no `require.main` guard, so
 * it must never be imported from a test. Every piece worth testing directly
 * — command dispatch, formatting, failure reporting — lives in
 * `cli-commands.ts`, which has no import-time side effect.
 *
 * Usage: `npx tsx src/search/operations/cli.ts <backfill|prune|retry-failed|coverage|projection-coverage>`
 * (wired as `pnpm --filter api search:backfill` etc. — see package.json).
 */
import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';

import { TenantDbService } from '../../db/tenant-db.service';
import { InstanceConfigService } from '../../instance-config/instance-config.service';
import { OperationsModule } from './operations.module';
import { SearchEmbedDispatchService } from '../search-embed-dispatch.service';
import { runCommand } from './cli-commands';

config({ path: '.env.local' });

async function main(command: string): Promise<void> {
  const app = await NestFactory.createApplicationContext(OperationsModule);
  try {
    await runCommand(command, {
      tenantDb: app.get(TenantDbService),
      instanceConfig: app.get(InstanceConfigService),
      dispatch: app.get(SearchEmbedDispatchService),
    });
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
    'Usage: tsx src/search/operations/cli.ts <backfill|prune|retry-failed|coverage|projection-coverage>',
  );
  process.exit(1);
}

main(command)
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`❌ search:${command} failed`);
    console.error(error);
    process.exit(1);
  });
