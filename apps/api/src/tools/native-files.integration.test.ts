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
import { KnowledgeSpaceLocalResolver } from '../knowledge/knowledge-space.local-resolver';
import { KnowledgeSpaceService } from '../knowledge/knowledge-space.service';
import { KnowledgeToolRuntimeResolver } from '../knowledge/knowledge-tool-runtime-resolver';
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

describe('kb:// mutations under real owner binding', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  const owner = randomUUID();
  const otherOwner = randomUUID();
  let root: string;
  let spaceId: string;
  let otherSpaceId: string;
  let runId: string;
  let context: ToolContext;
  let resolver: KnowledgeToolRuntimeResolver;

  function locator(space: string, relativePath: string): string {
    return `kb://${space}/${relativePath}`;
  }

  function notePath(space: string, relativePath: string): string {
    return join(root, space, ...relativePath.split('/'));
  }

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('Integration database was not provisioned.');
    sql = postgres(url, { max: 2 });
    tenantDb = new TenantDbService(drizzle(sql, { schema }));
    await sql`INSERT INTO users (id, name, email) VALUES (${owner}, 'KB', ${`${owner}@test.com`}), (${otherOwner}, 'KB other', ${`${otherOwner}@test.com`})`;
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kb-mutate-'));
    const spaces = new KnowledgeSpaceService(
      tenantDb,
      new KnowledgeSpaceLocalResolver(root),
    );
    resolver = new KnowledgeToolRuntimeResolver(spaces);
    spaceId = (await spaces.provisionForOwner(owner)).id;
    otherSpaceId = (await spaces.provisionForOwner(otherOwner)).id;
    await writeFile(notePath(spaceId, 'note.md'), 'alpha\nbeta\ngamma\n');
    await writeFile(notePath(otherSpaceId, 'note.md'), 'not yours\n');

    const chatId = randomUUID();
    const run = await tenantDb.runAs(owner, async (tx) => {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: owner,
        title: 'Knowledge mutations',
      });
      const message = await new MessagesRepository(tx).create({
        chatId,
        senderUserId: owner,
        role: 'user',
        parts: [{ type: 'text', text: 'Edit the note.' }],
      });
      const snapshot = await seedModelContextSnapshot(tx, owner, chatId, [
        'read',
        'edit',
        'write',
      ]);
      const runs = new RunsRepository(tx);
      const created = await runs.create({
        chatId,
        userId: owner,
        messageId: message.id,
        modelId: 'kb-test',
        modelContextSnapshotId: snapshot.id,
      });
      await runs.markStarted(created.id, owner);
      const started = await new RunEventsRepository(tx).append(
        created.id,
        'run.started',
      );
      return { id: created.id, startedSequence: started.sequence };
    });
    runId = run.id;
    // No `nativeExecutorId`: a kb:// mutation must work on a worker that has
    // never accepted host authority.
    context = {
      userId: owner,
      chatId,
      tenantDb,
      runId,
      nativeDeliverySequence: run.startedSequence,
      toolCallId: randomUUID(),
      knowledgeResolver: resolver,
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${owner}, ${otherOwner})`;
      await sql.end();
    }
  });

  it('edits an exact match and leaves the Run unbound to any worker', async () => {
    const result = await runTool(
      nativeEditTool,
      { path: locator(spaceId, 'note.md'), oldText: 'beta', newText: 'delta' },
      context,
      5,
    );
    expect(result).toMatchObject({
      status: 'success',
      operation: 'edit',
      replacements: 1,
      path: locator(spaceId, 'note.md'),
      knowledgeSpaceId: spaceId,
    });
    expect(JSON.stringify(result)).not.toContain(root);
    expect(await readFile(notePath(spaceId, 'note.md'), 'utf8')).toBe(
      'alpha\ndelta\ngamma\n',
    );
    const run = await tenantDb.runAs(owner, (tx) =>
      new RunsRepository(tx).findById(runId, owner),
    );
    expect(run?.workerId).toBeNull();
  });

  it('refuses an ambiguous edit without changing the note', async () => {
    await writeFile(notePath(spaceId, 'twice.md'), 'same\nsame\n');
    expect(
      await runTool(
        nativeEditTool,
        { path: locator(spaceId, 'twice.md'), oldText: 'same', newText: 'x' },
        context,
        5,
      ),
    ).toMatchObject({ status: 'error', type: 'old_text_ambiguous' });
    expect(await readFile(notePath(spaceId, 'twice.md'), 'utf8')).toBe(
      'same\nsame\n',
    );
  });

  it('creates a note and its missing intermediate directories, once', async () => {
    const target = locator(spaceId, 'research/2026/note.md');
    expect(
      await runTool(
        nativeWriteTool,
        { path: target, content: 'new\n' },
        context,
        5,
      ),
    ).toMatchObject({ status: 'success', created: true, path: target });
    expect(
      await readFile(notePath(spaceId, 'research/2026/note.md'), 'utf8'),
    ).toBe('new\n');

    expect(
      await runTool(
        nativeWriteTool,
        { path: target, content: 'again\n' },
        { ...context, toolCallId: randomUUID() },
        5,
      ),
    ).toMatchObject({ status: 'error', type: 'file_exists' });
    expect(
      await readFile(notePath(spaceId, 'research/2026/note.md'), 'utf8'),
    ).toBe('new\n');
  });

  it('refuses another owner Space and mutates nothing', async () => {
    expect(
      await runTool(
        nativeEditTool,
        {
          path: locator(otherSpaceId, 'note.md'),
          oldText: 'not yours',
          newText: 'mine now',
        },
        context,
        5,
      ),
    ).toEqual({
      status: 'error',
      type: 'knowledge_space_not_found',
      message: 'Knowledge Space was not found.',
    });
    expect(await readFile(notePath(otherSpaceId, 'note.md'), 'utf8')).toBe(
      'not yours\n',
    );
    const events = await tenantDb.runAs(owner, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, owner),
    );
    expect(events.some((event) => event.eventType === 'native.attempt')).toBe(
      false,
    );
  });

  it('replays an unsettled attempt on another worker without executor_unavailable', async () => {
    await tenantDb.runAs(owner, (tx) =>
      new NativeFilesRepository(tx).begin({
        runId,
        userId: owner,
        deliverySequence: context.nativeDeliverySequence,
        toolCallId: context.toolCallId!,
        operation: 'edit',
        path: locator(spaceId, 'note.md'),
      }),
    );
    // A different runs worker picks the Run up. It never had, and never needs,
    // an executor identity for a kb:// target.
    expect(
      await runTool(
        nativeEditTool,
        {
          path: locator(spaceId, 'note.md'),
          oldText: 'beta',
          newText: 'delta',
        },
        { ...context, nativeExecutorId: undefined },
        5,
      ),
    ).toMatchObject({ status: 'error', type: 'outcome_unknown' });
    expect(await readFile(notePath(spaceId, 'note.md'), 'utf8')).toBe(
      'alpha\nbeta\ngamma\n',
    );
  });

  it('records the locator as the attempt target, never the host path', async () => {
    await runTool(
      nativeEditTool,
      { path: locator(spaceId, 'note.md'), oldText: 'beta', newText: 'delta' },
      context,
      5,
    );
    const events = await tenantDb.runAs(owner, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, owner),
    );
    const attempt = events.find(
      (event) => event.eventType === 'native.attempt',
    );
    expect(attempt?.payload).toMatchObject({
      operation: 'edit',
      path: locator(spaceId, 'note.md'),
    });
    expect(JSON.stringify(events)).not.toContain(root);
  });
});
