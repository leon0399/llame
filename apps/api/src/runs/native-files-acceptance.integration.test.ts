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
import { KnowledgeSpaceLocalResolver } from '../knowledge/knowledge-space.local-resolver';
import { KnowledgeSpaceService } from '../knowledge/knowledge-space.service';
import { waitFor } from '../testing/support';

describe('native files through the model loop and durable worker', () => {
  let harness: WorkerHarness;
  let userId: string;
  let directory: string;
  let knowledgeRoot: string;
  let path: string;
  let created: string;
  const tools = ['read', 'edit', 'write', 'bash'];

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL)
      throw new Error('Integration database was not provisioned.');
    knowledgeRoot = await mkdtemp(join(tmpdir(), 'native-acceptance-kb-'));
    harness = await bootWorkerHarness({
      allowedTools: tools,
      nativeExecutorId: 'native-acceptance-host',
      knowledgeRoot,
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
    await rm(knowledgeRoot, { recursive: true, force: true });
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
      output: {
        content: '1: before\n2: Foo\n3: after\n',
        // Ranges, not just content: this fixture is small enough that one
        // line of context covers it, so content alone cannot tell an honored
        // selector from one that returned the whole file.
        requestedRange: { startLine: 2, endLine: 2 },
        shownRange: { startLine: 1, endLine: 3 },
      },
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
      expect(
        types.filter((type) =>
          ['native.attempt', 'native.result', 'tool.completed'].includes(type),
        ),
      ).toEqual(['native.attempt', 'native.result', 'tool.completed']);
    }
  });

  it('replaces an existing file through the actual model tool loop', async () => {
    const modelId = `native-replace-${randomUUID()}`;
    harness.models.register(modelId, {
      kind: 'tool-script',
      finalText: 'Native replace sequence finished.',
      calls: [
        {
          id: 'native-replace',
          name: 'write',
          input: { path, content: 'replaced bytes\n', replace: true },
        },
      ],
    });
    const seeded = await seedAndDispatchRun(harness, {
      userId,
      modelId,
      allowedTools: tools,
    });
    expect((await terminal(seeded.runId)).status).toBe('completed');
    expect(await readFile(path, 'utf8')).toBe('replaced bytes\n');

    const events = await harness.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(seeded.runId, userId),
    );
    const matching = events.filter(
      (event) =>
        isRecord(event.payload) &&
        event.payload.toolCallId === 'native-replace',
    );
    const types = matching.map((event) => event.eventType);
    expect(
      types.filter((type) =>
        ['native.attempt', 'native.result', 'tool.completed'].includes(type),
      ),
    ).toEqual(['native.attempt', 'native.result', 'tool.completed']);
    const completed = matching.find(
      (event) => event.eventType === 'tool.completed',
    )?.payload;
    expect(completed).toMatchObject({
      toolName: 'write',
      output: {
        status: 'success',
        operation: 'write',
        replaced: true,
        path,
      },
    });
    expect(
      isRecord(completed) &&
        isRecord(completed.output) &&
        'created' in completed.output,
    ).toBe(false);
  });

  it('replaces a Knowledge note through the worker without binding an executor', async () => {
    const spaces = new KnowledgeSpaceService(
      harness.tenantDb,
      new KnowledgeSpaceLocalResolver(knowledgeRoot),
    );
    const spaceId = (await spaces.provisionForOwner(userId)).id;
    const note = join(knowledgeRoot, spaceId, 'note.md');
    await writeFile(note, 'alpha\nbeta\n');
    const locator = `kb://${spaceId}/note.md`;
    const modelId = `native-kb-replace-${randomUUID()}`;
    harness.models.register(modelId, {
      kind: 'tool-script',
      finalText: 'Knowledge replace finished.',
      calls: [
        {
          id: 'kb-replace',
          name: 'write',
          input: { path: locator, content: 'replaced\n', replace: true },
        },
      ],
    });
    const seeded = await seedAndDispatchRun(harness, {
      userId,
      modelId,
      allowedTools: tools,
    });
    expect((await terminal(seeded.runId)).status).toBe('completed');
    expect(await readFile(note, 'utf8')).toBe('replaced\n');

    const events = await harness.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(seeded.runId, userId),
    );
    const attempt = events.find(
      (event) => event.eventType === 'native.attempt',
    );
    expect(attempt?.payload).toMatchObject({
      operation: 'write',
      path: locator,
    });
    // The locator is the recorded target and the result's identity; the
    // resolved host path never reaches the model or the event log.
    expect(JSON.stringify(events)).not.toContain(knowledgeRoot);
    const completed = events
      .filter((event) => event.eventType === 'tool.completed')
      .map((event) => event.payload);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      toolName: 'write',
      output: {
        status: 'success',
        operation: 'write',
        replaced: true,
        path: locator,
        knowledgeSpaceId: spaceId,
      },
    });
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

  // A replace is a `write` attempt like any other: the recorded operation
  // carries the mode-agnostic fence, so recovery must not replay it either.
  it.each(['edit', 'write', 'bash'] as const)(
    'does not invoke the model when another host recovers an open %s attempt',
    async (operation) => {
      const modelId = `native-retry-${randomUUID()}`;
      registerScript(modelId);
      const seeded = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId,
        allowedTools: tools,
      });
      const deliverySequence = await harness.tenantDb.runAs(
        userId,
        async (tx) => {
          const started = await new RunsRepository(tx).markStarted(
            seeded.runId,
            userId,
            { workerId: 'lost-host' },
          );
          if (!started) throw new Error('Native recovery Run did not start.');
          return (
            await new RunEventsRepository(tx).append(
              seeded.runId,
              'run.started',
            )
          ).sequence;
        },
      );
      await harness.tenantDb.runAs(userId, (tx) =>
        new NativeFilesRepository(tx).begin({
          runId: seeded.runId,
          userId,
          fence: { bound: true, executorId: 'lost-host' },
          deliverySequence,
          toolCallId: 'native-edit',
          operation,
          path,
        }),
      );
      await dispatchRun({ queue: harness.queue, ...seeded, userId, modelId });
      expect(await terminal(seeded.runId)).toMatchObject({
        status: 'failed',
        error: { code: 'outcome_unknown' },
      });
      expect(
        harness.models.streamCalls.filter((call) => call.modelId === modelId),
      ).toHaveLength(0);
      expect(await readFile(path, 'utf8')).toBe('before\nFoo\nafter\n');
    },
  );

  it('replays a settled replace into the terminal run instead of executing it again', async () => {
    const modelId = `native-replace-replay-${randomUUID()}`;
    registerScript(modelId);
    const seeded = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId,
      allowedTools: tools,
    });
    const settled = {
      status: 'success',
      operation: 'write',
      path,
      replaced: true,
      diff: '',
      content: '1: settled bytes\n',
      shownRange: { startLine: 1, endLine: 1 },
      truncated: false,
    };
    // A redelivery of a Run that already settled a replace: the attempt and
    // its result are recorded, and one tool activity was left open.
    const deliverySequence = await harness.tenantDb.runAs(
      userId,
      async (tx) => {
        const started = await new RunsRepository(tx).markStarted(
          seeded.runId,
          userId,
          { workerId: 'lost-host' },
        );
        if (!started) throw new Error('Native replay Run did not start.');
        const events = new RunEventsRepository(tx);
        const sequence = (await events.append(seeded.runId, 'run.started'))
          .sequence;
        await events.append(seeded.runId, 'tool.requested', {
          toolCallId: 'native-replay',
          toolName: 'write',
          input: { path, content: 'settled bytes\n', replace: true },
        });
        await events.append(seeded.runId, 'native.attempt', {
          toolCallId: 'native-replay',
          operation: 'write',
          path,
        });
        await events.append(seeded.runId, 'native.result', {
          toolCallId: 'native-replay',
          result: settled,
        });
        return sequence;
      },
    );
    expect(deliverySequence).toBeGreaterThan(0);

    await dispatchRun({ queue: harness.queue, ...seeded, userId, modelId });

    expect(await terminal(seeded.runId)).toMatchObject({
      status: 'failed',
      error: { code: 'outcome_unknown' },
    });
    expect(
      harness.models.streamCalls.filter((call) => call.modelId === modelId),
    ).toHaveLength(0);
    // The replace ran once, in the lost attempt; the redelivery neither
    // repeated it nor replaced the bytes it published.
    expect(await readFile(path, 'utf8')).toBe('before\nFoo\nafter\n');
    const events = await harness.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(seeded.runId, userId),
    );
    expect(
      events.filter((event) => event.eventType === 'native.attempt'),
    ).toHaveLength(1);
    const completed = events.find(
      (event) => event.eventType === 'tool.completed',
    );
    expect(completed?.payload).toMatchObject({
      toolCallId: 'native-replay',
      toolName: 'write',
      status: 'success',
      output: settled,
    });
  });

  it('does not invoke the model when another worker recovers an open kb:// replace', async () => {
    const spaces = new KnowledgeSpaceService(
      harness.tenantDb,
      new KnowledgeSpaceLocalResolver(knowledgeRoot),
    );
    const spaceId = (await spaces.provisionForOwner(userId)).id;
    const note = join(knowledgeRoot, spaceId, 'note.md');
    await writeFile(note, 'alpha\nbeta\n');
    const locator = `kb://${spaceId}/note.md`;
    const modelId = `native-kb-retry-${randomUUID()}`;
    harness.models.register(modelId, {
      kind: 'tool-script',
      finalText: 'Knowledge recovery never reaches the model.',
      calls: [
        {
          id: 'kb-retry',
          name: 'write',
          input: { path: locator, content: 'replaced\n', replace: true },
        },
      ],
    });
    const seeded = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId,
      allowedTools: tools,
    });
    const deliverySequence = await harness.tenantDb.runAs(
      userId,
      async (tx) => {
        const started = await new RunsRepository(tx).markStarted(
          seeded.runId,
          userId,
          { workerId: 'lost-host' },
        );
        if (!started) throw new Error('Knowledge recovery Run did not start.');
        return (
          await new RunEventsRepository(tx).append(seeded.runId, 'run.started')
        ).sequence;
      },
    );
    // No executor binding: a locator was never bound to the lost worker.
    await harness.tenantDb.runAs(userId, (tx) =>
      new NativeFilesRepository(tx).begin({
        runId: seeded.runId,
        userId,
        fence: { bound: false },
        deliverySequence,
        toolCallId: 'kb-retry',
        operation: 'write',
        path: locator,
      }),
    );
    await dispatchRun({ queue: harness.queue, ...seeded, userId, modelId });
    expect(await terminal(seeded.runId)).toMatchObject({
      status: 'failed',
      error: { code: 'outcome_unknown' },
    });
    expect(
      harness.models.streamCalls.filter((call) => call.modelId === modelId),
    ).toHaveLength(0);
    expect(await readFile(note, 'utf8')).toBe('alpha\nbeta\n');
  });
});
