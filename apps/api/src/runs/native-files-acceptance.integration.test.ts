import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRecord } from '@workspace/runtime-safety';
import {
  bootWorkerHarness,
  createUser,
  dispatchRun,
  seedAndDispatchRun,
  seedRun,
  type WorkerHarness,
} from './worker-harness';
import { RunsRepository, RunEventsRepository } from './runs-repository';
import { NativeFilesRepository } from './native-files-repository';
import { waitFor } from '../testing/support';

describe('native files through the model loop and durable worker', () => {
  let harness: WorkerHarness;
  let userId: string;
  let directory: string;
  let path: string;
  let created: string;
  const tools = ['read', 'edit', 'write'];

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL)
      throw new Error('Integration database was not provisioned.');
    harness = await bootWorkerHarness({
      allowedTools: tools,
      nativeExecutorId: 'native-acceptance-host',
    });
    userId = await createUser(harness.db, 'native-acceptance');
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'native-acceptance-'));
    path = join(directory, 'source');
    created = join(directory, 'created');
    await writeFile(path, 'before\nFoo\nafter\n');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    if (harness) await harness.close();
  });

  function terminal(runId: string) {
    return waitFor(
      async () => {
        const run = await harness.tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).findById(runId, userId),
        );
        return run &&
          ['completed', 'failed', 'cancelled', 'expired'].includes(run.status)
          ? run
          : undefined;
      },
      20_000,
      'native Run to settle',
    );
  }

  function registerScript(modelId: string) {
    harness.models.register(modelId, {
      kind: 'tool-script',
      finalText: 'Native file sequence finished.',
      calls: [
        { id: 'native-read', name: 'read', input: { path: `${path}:2-2` } },
        {
          id: 'native-edit',
          name: 'edit',
          input: { path, oldText: 'Foo', newText: 'Bar' },
        },
        { id: 'native-reread', name: 'read', input: { path: `${path}:raw` } },
        {
          id: 'native-write',
          name: 'write',
          input: { path: created, content: 'created bytes\n' },
        },
      ],
    });
  }

  it('reads, edits, rereads and creates through the actual model tool loop', async () => {
    const modelId = `native-${randomUUID()}`;
    registerScript(modelId);
    const seeded = await seedAndDispatchRun(harness, {
      userId,
      modelId,
      allowedTools: tools,
    });
    expect((await terminal(seeded.runId)).status).toBe('completed');
    expect(await readFile(path, 'utf8')).toBe('before\nBar\nafter\n');
    expect(await readFile(created, 'utf8')).toBe('created bytes\n');
    const events = await harness.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(seeded.runId, userId),
    );
    const completed = events
      .filter((event) => event.eventType === 'tool.completed')
      .map((event) => event.payload);
    expect(completed).toHaveLength(4);
    expect(completed[0]).toMatchObject({
      toolName: 'read',
      output: { content: '1: before\n2: Foo\n3: after\n' },
    });
    expect(completed[1]).toMatchObject({
      toolName: 'edit',
      output: { status: 'success', replacements: 1 },
    });
    expect(completed[2]).toMatchObject({
      toolName: 'read',
      output: { content: 'before\nBar\nafter\n' },
    });
    for (const callId of ['native-edit', 'native-write']) {
      const matching = events.filter(
        (event) =>
          isRecord(event.payload) && event.payload.toolCallId === callId,
      );
      const types = matching.map((event) => event.eventType);
      expect(types.indexOf('native.attempt')).toBeLessThan(
        types.indexOf('native.result'),
      );
      expect(types.indexOf('native.result')).toBeLessThan(
        types.indexOf('tool.completed'),
      );
    }
  });

  it('stops the SDK loop after an unknown mutation instead of reaching the next write', async () => {
    const modelId = `native-unknown-${randomUUID()}`;
    registerScript(modelId);
    vi.spyOn(NativeFilesRepository.prototype, 'priorOutcome').mockResolvedValue(
      {
        status: 'error',
        type: 'outcome_unknown',
        message: 'Unsettled prior mutation.',
      },
    );
    const seeded = await seedAndDispatchRun(harness, {
      userId,
      modelId,
      allowedTools: tools,
    });
    expect((await terminal(seeded.runId)).status).toBe('failed');
    expect(await readFile(path, 'utf8')).toBe('before\nFoo\nafter\n');
    await expect(stat(created)).rejects.toMatchObject({ code: 'ENOENT' });
    const events = await harness.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(seeded.runId, userId),
    );
    const names = events
      .filter((event) => event.eventType === 'tool.requested')
      .map((event) =>
        isRecord(event.payload) ? event.payload.toolName : undefined,
      );
    expect(names).toEqual(['read', 'edit']);
  });

  it('does not invoke the model when the queue recovers a Run with an open mutation', async () => {
    const modelId = `native-retry-${randomUUID()}`;
    registerScript(modelId);
    const seeded = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId,
      allowedTools: tools,
    });
    await harness.tenantDb.runAs(userId, (tx) =>
      new NativeFilesRepository(tx).begin({
        runId: seeded.runId,
        userId,
        executorId: 'native-acceptance-host',
        toolCallId: 'native-edit',
        operation: 'edit',
        path,
      }),
    );
    await dispatchRun({ queue: harness.queue, ...seeded, userId, modelId });
    expect((await terminal(seeded.runId)).status).toBe('failed');
    expect(
      harness.models.streamCalls.filter((call) => call.modelId === modelId),
    ).toHaveLength(0);
    expect(await readFile(path, 'utf8')).toBe('before\nFoo\nafter\n');
  });
});
