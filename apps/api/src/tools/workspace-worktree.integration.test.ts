/* eslint-disable typescript/no-unsafe-assignment -- a run event's `payload` and a tool observation are stored JSONB, so each read is narrowed with `isRecord` before it is asserted on. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { isContextItemPart } from '../chats/context-item';
import { RepositoriesRepository } from '../repositories/repositories.repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { type ScriptedBehavior } from '../runs/scripted-model-client';
import {
  bootWorkerHarness,
  createUser,
  seedAndDispatchRun,
  type WorkerHarness,
} from '../runs/worker-harness';
import { waitFor } from '../testing/support';

/**
 * Worktree entry end to end (openspec `repositories` design D5 and D6): the real
 * worker graph, the real tool loop, a real git clone, and a real database.
 *
 * What no unit test can prove is here: that the attempt, the checkout row, the
 * lease, the adopted rows, and the bound root commit together, that a failure
 * leaves the previous binding and its generation alone, that two Chats adopting
 * one clone end with one repository, and that the Chat's narration names the new
 * root once.
 *
 * TEST_DATABASE_URL-gated — skipped otherwise.
 */

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'])
  .toString()
  .split('\n')) {
  if (name !== '') delete process.env[name];
}

vi.setConfig({ testTimeout: 90_000 });

const created: Array<string> = [];

function tempDirectory(prefix = 'worktree-integration-'): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  created.push(directory);
  return directory;
}

function runGit(cwd: string, args: ReadonlyArray<string>): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  });
}

/** One clone in a directory of its own, so each fixture places privately. */
function clone(options: { readonly remote?: string } = {}): string {
  const directory = join(tempDirectory('worktree-clone-'), 'llame');
  mkdirSync(directory);
  runGit(directory, ['init', '--quiet', '--initial-branch=main', '.']);
  runGit(directory, ['config', 'user.name', 'llame tests']);
  runGit(directory, ['config', 'user.email', 'llame@test.invalid']);
  runGit(directory, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(directory, 'README.md'), 'readme\n');
  runGit(directory, ['add', 'README.md']);
  runGit(directory, ['commit', '--quiet', '--message', 'first']);
  if (options.remote !== undefined) {
    runGit(directory, ['remote', 'add', 'origin', options.remote]);
  }
  return directory;
}

function linkedWorktree(main: string, branch: string): string {
  const target = join(tempDirectory('worktree-linked-'), branch);
  runGit(main, ['worktree', 'add', '--quiet', '-b', branch, target]);
  return target;
}

function headOf(directory: string): string {
  return runGit(directory, ['rev-parse', 'HEAD']).trim();
}

/** One `enter_workspace` call, then a final answer, from the scripted model. */
function worktreeCall(
  path: string,
  worktree: UnknownRecord | undefined,
  callId = 'worktree-entry',
): ScriptedBehavior {
  return {
    kind: 'tool-script',
    calls: [
      {
        id: callId,
        name: 'enter_workspace',
        input: {
          path,
          ...(worktree !== undefined && { worktree }),
        },
      },
    ],
    finalText: 'Worktree entry done.',
  };
}

afterAll(() => {
  for (const directory of created) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describeIfDb('enter_workspace with a worktree, over the real worker', () => {
  let harness: WorkerHarness;
  let userId: string;
  let modelSequence = 0;

  beforeAll(async () => {
    harness = await bootWorkerHarness({
      nativeExecutorId: 'worktree-host',
      allowedTools: ['enter_workspace'],
      runsConcurrency: 2,
    });
    userId = await createUser(harness.db, 'worktree');
  });

  afterAll(async () => {
    await harness.close();
  });

  /** One run whose model calls `enter_workspace` once, waited to completion. */
  async function runEntry(
    path: string,
    worktree: UnknownRecord | undefined,
    options: { readonly chatId?: string; readonly callId?: string } = {},
  ): Promise<{ readonly chatId: string; readonly runId: string }> {
    modelSequence += 1;
    const modelId = `worktree-entry-${modelSequence}`;
    harness.models.register(
      modelId,
      worktreeCall(path, worktree, options.callId),
    );
    const seed = await seedAndDispatchRun(harness, {
      userId,
      modelId,
      ...(options.chatId !== undefined && { chatId: options.chatId }),
    });
    await waitFor(
      async () => {
        const events = await harness.tenantDb.runAs(userId, (tx) =>
          new RunEventsRepository(tx).listByRunId(seed.runId, userId),
        );
        return events.some((event) => event.eventType === 'run.completed')
          ? true
          : undefined;
      },
      60_000,
      `run ${seed.runId} to complete`,
    );
    return seed;
  }

  /** The observation the Run recorded for one tool call. */
  async function observationOf(
    runId: string,
    callId: string,
  ): Promise<UnknownRecord> {
    const events = await harness.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, userId),
    );
    const completed = events.find(
      (event) =>
        event.eventType === 'tool.completed' &&
        isRecord(event.payload) &&
        event.payload['toolCallId'] === callId,
    );
    const output = isRecord(completed?.payload)
      ? completed.payload['output']
      : undefined;
    if (!isRecord(output)) {
      throw new Error(`The Run recorded no output for ${callId}.`);
    }
    return output;
  }

  async function chatOf(chatId: string) {
    const chat = await harness.tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).findById(chatId, userId),
    );
    if (chat === undefined) throw new Error(`No chat ${chatId}.`);
    return chat;
  }

  async function catalog() {
    return harness.tenantDb.runAs(userId, async (tx) => {
      const repositories = new RepositoriesRepository(tx);
      const checkouts = await repositories.listCheckouts(userId);
      return {
        checkouts,
        repositories: await repositories.listRepositories(userId),
        leases: await Promise.all(
          checkouts.map((checkout) =>
            repositories.findLease(userId, checkout.id),
          ),
        ),
      };
    });
  }

  async function workspaceItems(chatId: string, runId: string) {
    const messages = await harness.tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    return messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        isContextItemPart(part) &&
        isRecord(part.data) &&
        part.data['runId'] === runId &&
        part.data['producer'] === 'workspace'
          ? [part.data]
          : [],
      ),
    );
  }

  it('creates the worktree, records the rows, one attempt, and one narration', async () => {
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const base = headOf(source);
    const directory = join(
      source,
      '..',
      '.llame-worktrees',
      'llame',
      'clear-field-0192',
    );

    const { chatId, runId } = await runEntry(source, {
      name: 'clear-field-0192',
    });

    expect(await observationOf(runId, 'worktree-entry')).toMatchObject({
      status: 'success',
      root: directory,
      worktree: {
        path: directory,
        branch: 'llame/clear-field-0192',
        baseCommit: base,
      },
    });
    const chat = await chatOf(chatId);
    expect(chat).toMatchObject({
      workspaceRoot: directory,
      workspaceExecutorId: 'worktree-host',
      workspaceGeneration: 1,
    });

    const rows = await catalog();
    const repository = rows.repositories.find(
      (row) => row.canonicalRemote === 'github.com/leon0399/llame',
    );
    expect(repository).toMatchObject({ displayName: 'llame' });
    const main = rows.checkouts.find((row) => row.path === source);
    expect(main).toMatchObject({
      kind: 'main',
      origin: 'adopted',
      parentCheckoutId: null,
      branch: null,
    });
    const worktree = rows.checkouts.find((row) => row.path === directory);
    expect(worktree).toMatchObject({
      kind: 'worktree',
      origin: 'created',
      branch: 'llame/clear-field-0192',
      parentCheckoutId: main?.id,
      repositoryId: repository?.id,
    });
    const lease = rows.leases.find((row) => row?.checkoutId === worktree?.id);
    expect(lease).toMatchObject({ chatId, baseCommit: base, baseRef: base });

    const events = await harness.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, userId),
    );
    const attempts = events.filter(
      (event) =>
        event.eventType === 'native.attempt' &&
        isRecord(event.payload) &&
        event.payload['operation'] === 'worktree',
    );
    expect(attempts).toHaveLength(1);
    const attempt = attempts[0]?.payload;
    expect(isRecord(attempt) ? attempt : {}).toMatchObject({
      toolCallId: 'worktree-entry',
      path: directory,
    });
    const results = events.filter(
      (event) =>
        event.eventType === 'native.result' &&
        isRecord(event.payload) &&
        event.payload['toolCallId'] === 'worktree-entry',
    );
    expect(results).toHaveLength(1);
    const result = results[0]?.payload;
    expect(isRecord(result) ? result : {}).toMatchObject({
      result: expect.objectContaining({ status: 'success', root: directory }),
    });
    // The `workspace` producer narrates a changed binding on the next accepted
    // turn, so the creating Run stores no item for it; the binding it would
    // narrate is the root and generation asserted above.
    expect(await workspaceItems(chatId, runId)).toHaveLength(0);
  });

  it('reuses an adopted clone instead of recording it twice', async () => {
    const source = clone({ remote: 'git@github.com:leon0399/reused.git' });
    await runEntry(source, { name: 'first' });
    const afterFirst = await catalog();
    await runEntry(source, { name: 'second' });
    const afterSecond = await catalog();

    const ofRemote = (rows: typeof afterFirst) =>
      rows.repositories.filter(
        (row) => row.canonicalRemote === 'github.com/leon0399/reused',
      );
    expect(ofRemote(afterFirst)).toHaveLength(1);
    expect(ofRemote(afterSecond)).toHaveLength(1);
    const mainRows = afterSecond.checkouts.filter(
      (row) => row.path === source && row.kind === 'main',
    );
    expect(mainRows).toHaveLength(1);
    const worktrees = afterSecond.checkouts.filter(
      (row) =>
        row.kind === 'worktree' && row.parentCheckoutId === mainRows[0]?.id,
    );
    expect(
      worktrees.map((row) => row.branch).sort((a, b) => a.localeCompare(b)),
    ).toStrictEqual(['llame/first', 'llame/second']);
  });

  it('records one repository and one main checkout for two concurrent adopters', async () => {
    const source = clone({ remote: 'git@github.com:leon0399/concurrent.git' });
    modelSequence += 1;
    const first = `worktree-concurrent-a-${modelSequence}`;
    const second = `worktree-concurrent-b-${modelSequence}`;
    harness.models.register(first, worktreeCall(source, { name: 'a' }));
    harness.models.register(second, worktreeCall(source, { name: 'b' }));
    const [runA, runB] = await Promise.all([
      seedAndDispatchRun(harness, { userId, modelId: first }),
      seedAndDispatchRun(harness, { userId, modelId: second }),
    ]);
    for (const run of [runA, runB]) {
      await waitFor(
        async () => {
          const events = await harness.tenantDb.runAs(userId, (tx) =>
            new RunEventsRepository(tx).listByRunId(run.runId, userId),
          );
          return events.some((event) => event.eventType === 'run.completed')
            ? true
            : undefined;
        },
        60_000,
        `run ${run.runId} to complete`,
      );
    }

    const rows = await catalog();
    expect(
      rows.repositories.filter(
        (row) => row.canonicalRemote === 'github.com/leon0399/concurrent',
      ),
    ).toHaveLength(1);
    const mains = rows.checkouts.filter(
      (row) => row.path === source && row.kind === 'main',
    );
    expect(mains).toHaveLength(1);
    const worktrees = rows.checkouts.filter(
      (row) => row.parentCheckoutId === mains[0]?.id,
    );
    expect(worktrees).toHaveLength(2);
    for (const run of [runA, runB]) {
      const chat = await chatOf(run.chatId);
      expect(chat.workspaceRoot).toContain(
        join(source, '..', '.llame-worktrees'),
      );
      expect(chat.workspaceGeneration).toBe(1);
    }
  });

  it('adopts a remote-less clone without a remote identity', async () => {
    const source = clone();
    const { runId } = await runEntry(source, { name: 'no-remote' });
    const rows = await catalog();
    const main = rows.checkouts.find((row) => row.path === source);
    const repository = rows.repositories.find(
      (row) => row.id === main?.repositoryId,
    );

    expect(await observationOf(runId, 'worktree-entry')).toMatchObject({
      status: 'success',
    });
    expect(repository).toMatchObject({
      canonicalRemote: null,
      displayName: 'llame',
    });
  });

  it('uses the main clone of a linked-worktree source as the parent', async () => {
    const source = clone({ remote: 'git@github.com:leon0399/linked.git' });
    const linked = linkedWorktree(source, 'feature');
    const { runId } = await runEntry(linked, { name: 'clear-field-0192' });

    const rows = await catalog();
    const main = rows.checkouts.find((row) => row.path === source);
    const recorded = rows.checkouts.find((row) => row.path === linked);
    // Scoped to this clone's own parent directory: another test of this file
    // creates a worktree on the same branch name beside a different clone.
    const worktree = rows.checkouts.find(
      (row) =>
        row.kind === 'worktree' && row.path.startsWith(join(source, '..')),
    );

    expect(await observationOf(runId, 'worktree-entry')).toMatchObject({
      status: 'success',
      root: join(
        source,
        '..',
        '.llame-worktrees',
        'linked',
        'clear-field-0192',
      ),
    });
    expect(main).toMatchObject({ kind: 'main', origin: 'adopted' });
    expect(recorded).toMatchObject({
      kind: 'worktree',
      origin: 'adopted',
      branch: 'feature',
      parentCheckoutId: main?.id,
    });
    expect(worktree).toMatchObject({ parentCheckoutId: main?.id });
  });

  it('leaves the binding alone when git cannot create the worktree', async () => {
    const source = clone({ remote: 'git@github.com:leon0399/broken.git' });
    runGit(source, ['branch', 'llame/taken']);
    const before = await catalog();

    const { chatId, runId } = await runEntry(source, { name: 'taken' });

    const observation = await observationOf(runId, 'worktree-entry');
    expect(observation).toMatchObject({
      status: 'error',
      type: 'worktree_failed',
    });
    expect(isString(observation['message'])).toBe(true);
    const chat = await chatOf(chatId);
    expect(chat).toMatchObject({
      workspaceRoot: null,
      workspaceGeneration: 0,
    });
    const after = await catalog();
    expect(after.repositories).toHaveLength(before.repositories.length);
    expect(after.checkouts).toHaveLength(before.checkouts.length);
  });
});
