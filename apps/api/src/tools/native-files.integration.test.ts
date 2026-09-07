import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { RunsRepository, RunEventsRepository } from '../runs/runs-repository';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { seedModelContextSnapshot } from '../runs/model-context-snapshot.test-fixture';
import {
  nativeReadTool,
  nativeEditTool,
  nativeWriteTool,
} from './native-files';
import { runTool } from './runner';
import { type ToolContext } from './types';

describe('native file authority and durable effects', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  const owner = randomUUID();
  const otherOwner = randomUUID();
  let directory: string;
  let path: string;
  let context: ToolContext;
  let runId: string;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('Integration database was not provisioned.');
    sql = postgres(url, { max: 2 });
    tenantDb = new TenantDbService(drizzle(sql, { schema }));
    await sql`INSERT INTO users (id, name, email) VALUES (${owner}, 'Native', ${`${owner}@test.com`}), (${otherOwner}, 'Other', ${`${otherOwner}@test.com`})`;
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'native-runtime-'));
    path = join(directory, 'notes');
    await writeFile(path, 'before\nFoo\nafter\n');
    const chatId = randomUUID();
    const run = await tenantDb.runAs(owner, async (tx) => {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: owner,
        title: 'Native files',
      });
      const message = await new MessagesRepository(tx).create({
        chatId,
        senderUserId: owner,
        role: 'user',
        parts: [{ type: 'text', text: 'Edit the native file.' }],
      });
      const snapshot = await seedModelContextSnapshot(tx, owner, chatId, [
        'read',
        'edit',
        'write',
      ]);
      const runs = new RunsRepository(tx);
      const run = await runs.create({
        chatId,
        userId: owner,
        messageId: message.id,
        modelId: 'native-test',
        modelContextSnapshotId: snapshot.id,
      });
      await runs.markStarted(run.id, owner);
      const started = await new RunEventsRepository(tx).append(
        run.id,
        'run.started',
      );
      return { id: run.id, startedSequence: started.sequence };
    });
    runId = run.id;
    context = {
      userId: owner,
      chatId,
      tenantDb,
      runId,
      nativeExecutorId: 'host-a',
      nativeDeliverySequence: run.startedSequence,
      toolCallId: randomUUID(),
    };
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${owner}, ${otherOwner})`;
      await sql.end();
    }
  });

  const claimDelivery = () =>
    tenantDb.runAs(owner, async (tx) => {
      const started = await new RunsRepository(tx).markStarted(runId, owner);
      if (!started) return undefined;
      if (
        started.workerId !== null &&
        (await new NativeFilesRepository(tx).hasMutation(runId))
      ) {
        return undefined;
      }
      return (await new RunEventsRepository(tx).append(runId, 'run.started'))
        .sequence;
    });

  const begin = (input: {
    deliverySequence?: number;
    toolCallId: string;
    operation: 'read' | 'edit' | 'write';
  }) =>
    tenantDb.runAs(owner, (tx) =>
      new NativeFilesRepository(tx).begin({
        runId,
        userId: owner,
        executorId: 'host-a',
        deliverySequence: input.deliverySequence,
        toolCallId: input.toolCallId,
        operation: input.operation,
        path,
      }),
    );

  it('binds on the first read and rejects another host before mutation', async () => {
    expect(await runTool(nativeReadTool, { path }, context, 5)).toMatchObject({
      status: 'success',
      content: '1: before\n2: Foo\n3: after\n',
    });
    const run = await tenantDb.runAs(owner, (tx) =>
      new RunsRepository(tx).findById(runId, owner),
    );
    expect(run?.workerId).toBe('host-a');
    const result = await runTool(
      nativeEditTool,
      { path, oldText: 'Foo', newText: 'Bar' },
      { ...context, nativeExecutorId: 'host-b', toolCallId: randomUUID() },
      5,
    );
    expect(result).toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
    });
    expect(await readFile(path, 'utf8')).toBe('before\nFoo\nafter\n');
  });

  it('settles a mutation before returning and replays its result without executing', async () => {
    const args = { path, oldText: 'Foo', newText: 'Bar' };
    const result = await runTool(nativeEditTool, args, context, 5);
    expect(result).toMatchObject({ status: 'success', replacements: 1 });
    const events = await tenantDb.runAs(owner, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, owner),
    );
    expect(events.map((event) => event.eventType)).toEqual([
      'run.started',
      'native.attempt',
      'native.result',
    ]);
    expect(events[2].payload).toEqual({
      toolCallId: context.toolCallId,
      result,
    });
    await writeFile(path, 'Foo was independently restored');
    expect(await runTool(nativeEditTool, args, context, 5)).toEqual(result);
    expect(await readFile(path, 'utf8')).toBe('Foo was independently restored');
  });

  it('never executes an open attempt after recovery', async () => {
    await tenantDb.runAs(owner, (tx) =>
      new NativeFilesRepository(tx).begin({
        runId,
        userId: owner,
        executorId: 'host-a',
        deliverySequence: context.nativeDeliverySequence,
        toolCallId: context.toolCallId!,
        operation: 'edit',
        path,
      }),
    );
    expect(
      await runTool(
        nativeEditTool,
        { path, oldText: 'Foo', newText: 'Bar' },
        context,
        5,
      ),
    ).toMatchObject({ status: 'error', type: 'outcome_unknown' });
    expect(await readFile(path, 'utf8')).toBe('before\nFoo\nafter\n');
    expect(
      await tenantDb.runAs(owner, (tx) =>
        new NativeFilesRepository(tx).hasMutation(runId),
      ),
    ).toBe(true);
  });

  it('allows only the newest concurrent delivery to admit a native mutation', async () => {
    const sequences = await Promise.all([claimDelivery(), claimDelivery()]);
    expect(
      sequences.every((sequence): sequence is number => sequence !== undefined),
    ).toBe(true);
    const latestSequence = Math.max(
      ...sequences.filter((sequence) => sequence !== undefined),
    );
    const latestIndex = sequences.indexOf(latestSequence);
    const calls = sequences.map((_, index) => `delivery-${index}`);
    const results = await Promise.all(
      sequences.map((deliverySequence, index) =>
        runTool(
          nativeEditTool,
          { path, oldText: 'Foo', newText: `Bar-${index}` },
          {
            ...context,
            nativeDeliverySequence: deliverySequence,
            toolCallId: calls[index],
          },
          5,
        ),
      ),
    );

    expect(results[latestIndex]).toMatchObject({
      status: 'success',
      replacements: 1,
    });
    expect(results[1 - latestIndex]).toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
    });
    expect(await readFile(path, 'utf8')).toBe(
      `before\nBar-${latestIndex}\nafter\n`,
    );
    const events = await tenantDb.runAs(owner, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, owner),
    );
    const attempts = events.filter(
      (event) => event.eventType === 'native.attempt',
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.payload).toMatchObject({
      toolCallId: calls[latestIndex],
    });
  });

  it('rejects a stale read after a newer delivery claim', async () => {
    const sequences = await Promise.all([claimDelivery(), claimDelivery()]);
    const olderSequence = Math.min(
      ...sequences.filter(
        (sequence): sequence is number => sequence !== undefined,
      ),
    );
    const newerSequence = Math.max(
      ...sequences.filter(
        (sequence): sequence is number => sequence !== undefined,
      ),
    );

    expect(
      await runTool(
        nativeReadTool,
        { path },
        {
          ...context,
          nativeDeliverySequence: olderSequence,
          toolCallId: 'stale-read',
        },
        5,
      ),
    ).toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
    });
    expect(
      await runTool(
        nativeReadTool,
        { path },
        {
          ...context,
          nativeDeliverySequence: newerSequence,
          toolCallId: 'current-read',
        },
        5,
      ),
    ).toMatchObject({ status: 'success' });
  });

  it('does not bind a stale delivery host before the current delivery succeeds', async () => {
    const sequences = await Promise.all([claimDelivery(), claimDelivery()]);
    const olderSequence = Math.min(
      ...sequences.filter(
        (sequence): sequence is number => sequence !== undefined,
      ),
    );
    const newerSequence = Math.max(
      ...sequences.filter(
        (sequence): sequence is number => sequence !== undefined,
      ),
    );

    expect(
      await runTool(
        nativeReadTool,
        { path },
        {
          ...context,
          nativeExecutorId: 'host-a',
          nativeDeliverySequence: olderSequence,
          toolCallId: 'stale-host',
        },
        5,
      ),
    ).toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
    });
    expect(
      await tenantDb.runAs(owner, (tx) =>
        new RunsRepository(tx).findById(runId, owner),
      ),
    ).toMatchObject({ workerId: null });

    expect(
      await runTool(
        nativeReadTool,
        { path },
        {
          ...context,
          nativeExecutorId: 'host-b',
          nativeDeliverySequence: newerSequence,
          toolCallId: 'current-host',
        },
        5,
      ),
    ).toMatchObject({ status: 'success' });
    expect(
      await tenantDb.runAs(owner, (tx) =>
        new RunsRepository(tx).findById(runId, owner),
      ),
    ).toMatchObject({ workerId: 'host-b' });
  });

  it('rejects a redelivery after the first native mutation is admitted', async () => {
    const sequence = context.nativeDeliverySequence;
    const first = await begin({
      deliverySequence: sequence,
      toolCallId: 'first-mutation',
      operation: 'edit',
    });
    expect(first).toBeUndefined();

    expect(await claimDelivery()).toBeUndefined();
    const events = await tenantDb.runAs(owner, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, owner),
    );
    expect(
      events.filter((event) => event.eventType === 'run.started'),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.eventType === 'native.attempt'),
    ).toHaveLength(1);
  });

  it('deduplicates concurrent admissions with the same tool call id', async () => {
    const results = await Promise.all([
      begin({
        deliverySequence: context.nativeDeliverySequence,
        toolCallId: 'same-call',
        operation: 'edit',
      }),
      begin({
        deliverySequence: context.nativeDeliverySequence,
        toolCallId: 'same-call',
        operation: 'edit',
      }),
    ]);
    expect(results.filter((result) => result === undefined)).toHaveLength(1);
    expect(
      results.filter((result) => result?.type === 'outcome_unknown'),
    ).toHaveLength(1);
    const events = await tenantDb.runAs(owner, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, owner),
    );
    expect(
      events.filter((event) => event.eventType === 'native.attempt'),
    ).toHaveLength(1);
  });

  it('does not let another tenant bind or mutate through an owned Run', async () => {
    const foreign = { ...context, userId: otherOwner };
    expect(
      await runTool(
        nativeEditTool,
        { path, oldText: 'Foo', newText: 'Bar' },
        foreign,
        5,
      ),
    ).toMatchObject({ status: 'error', type: 'executor_unavailable' });
    expect(await readFile(path, 'utf8')).toBe('before\nFoo\nafter\n');
    expect(
      await tenantDb.runAs(otherOwner, (tx) =>
        new NativeFilesRepository(tx).hasMutation(runId),
      ),
    ).toBe(false);
  });

  it('orders same-path mutations before asynchronous database admission', async () => {
    const [first, second] = await Promise.all([
      runTool(
        nativeEditTool,
        { path, oldText: 'Foo', newText: 'Bar' },
        { ...context, toolCallId: 'first' },
        5,
      ),
      runTool(
        nativeEditTool,
        { path, oldText: 'Foo', newText: 'Baz' },
        { ...context, toolCallId: 'second' },
        5,
      ),
    ]);
    expect(first).toMatchObject({ status: 'success' });
    expect(second).toMatchObject({
      status: 'error',
      type: 'old_text_not_found',
    });
    expect(await readFile(path, 'utf8')).toBe('before\nBar\nafter\n');
  });

  it('creates through the same native runtime and preserves existing files', async () => {
    const createdPath = join(directory, 'created');
    expect(
      await runTool(
        nativeWriteTool,
        { path: createdPath, content: 'new' },
        context,
        5,
      ),
    ).toMatchObject({ status: 'success', created: true });
    expect(
      await runTool(
        nativeWriteTool,
        { path: createdPath, content: 'replacement' },
        { ...context, toolCallId: randomUUID() },
        5,
      ),
    ).toMatchObject({ type: 'file_exists' });
    expect(await readFile(createdPath, 'utf8')).toBe('new');
  });
});
