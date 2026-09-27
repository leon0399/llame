/**
 * Workspace binding repository integration coverage against real PostgreSQL.
 *
 * TEST_DATABASE_URL-gated; the integration project provisions a FORCE-RLS
 * database when no external URL is supplied.
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { WorkspaceBindingRepository } from './workspace-binding.repository';
import { type WorkspaceDetachReason } from './workspace-binding';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type WorkspaceRow = {
  workspaceRoot: string | null;
  workspaceExecutorId: string | null;
  workspaceGeneration: number;
  workspaceTold: string | null;
  workspaceToldFrom: string | null;
  workspaceDetachReason: string | null;
};

describeIfDb('WorkspaceBindingRepository — PostgreSQL lifecycle', () => {
  let sql: Sql;
  let db: Db;
  let tenantDb: TenantDbService;
  const owner = crypto.randomUUID();
  let chatId: string;
  let runId: string;
  let startedSequence: number;

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL!, {
      max: 2,
      ssl: /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false,
    });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    await sql`INSERT INTO users (id, name, email) VALUES (${owner}, 'Workspace binding', ${`${owner}@test.com`})`;
  });

  beforeEach(async () => {
    chatId = crypto.randomUUID();
    const seeded = await tenantDb.runAs(owner, async (tx) => {
      const createdChat = await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: owner,
        title: 'Workspace binding',
      });
      if (createdChat === undefined) {
        throw new Error('Workspace binding integration chat was not created');
      }
      const message = await new MessagesRepository(tx).create({
        chatId,
        role: 'user',
        senderUserId: owner,
        parts: [{ type: 'text', text: 'Bind a workspace.' }],
      });
      const run = await new RunsRepository(tx).create({
        chatId,
        userId: owner,
        messageId: message.id,
        modelId: 'workspace-binding-test',
      });
      const started = await new RunsRepository(tx).markStarted(run.id, owner);
      if (started === undefined) {
        throw new Error('Workspace binding integration Run did not start');
      }
      const event = await new RunEventsRepository(tx).append(
        run.id,
        'run.started',
      );
      return { runId: run.id, startedSequence: event.sequence };
    });
    runId = seeded.runId;
    startedSequence = seeded.startedSequence;
  });

  afterEach(async () => {
    await tenantDb.runAs(owner, (tx) =>
      new ChatsRepository(tx).deleteById(chatId, owner),
    );
  });

  afterAll(async () => {
    await sql.end();
  });

  const readWorkspace = async (): Promise<WorkspaceRow> => {
    const row = await tenantDb.runAs(owner, async (tx) => {
      const [current] = await tx
        .select({
          workspaceRoot: schema.chats.workspaceRoot,
          workspaceExecutorId: schema.chats.workspaceExecutorId,
          workspaceGeneration: schema.chats.workspaceGeneration,
          workspaceTold: schema.chats.workspaceTold,
          workspaceToldFrom: schema.chats.workspaceToldFrom,
          workspaceDetachReason: schema.chats.workspaceDetachReason,
        })
        .from(schema.chats)
        .where(
          and(eq(schema.chats.id, chatId), eq(schema.chats.ownerUserId, owner)),
        )
        .limit(1);
      return current;
    });
    if (row === undefined) {
      throw new Error('Workspace binding integration chat was not found');
    }
    return row;
  };

  const readRun = async (): Promise<{ workerId: string | null }> => {
    const row = await tenantDb.runAs(owner, async (tx) => {
      const [current] = await tx
        .select({ workerId: schema.runs.workerId })
        .from(schema.runs)
        .where(and(eq(schema.runs.id, runId), eq(schema.runs.userId, owner)))
        .limit(1);
      return current;
    });
    if (row === undefined) {
      throw new Error('Workspace binding integration Run was not found');
    }
    return row;
  };

  const enter = (root: string, deliverySequence = startedSequence) =>
    tenantDb.runAs(owner, (tx) =>
      new WorkspaceBindingRepository(tx).enter({
        chatId,
        ownerUserId: owner,
        runId,
        deliverySequence,
        executorId: 'executor-a',
        root,
      }),
    );

  const exit = (deliverySequence = startedSequence) =>
    tenantDb.runAs(owner, (tx) =>
      new WorkspaceBindingRepository(tx).exit({
        chatId,
        ownerUserId: owner,
        runId,
        deliverySequence,
        executorId: 'executor-a',
      }),
    );

  const detach = (
    expectedGeneration: number,
    reason: WorkspaceDetachReason,
    deliverySequence = startedSequence,
  ) =>
    tenantDb.runAs(owner, (tx) =>
      new WorkspaceBindingRepository(tx).detach({
        chatId,
        ownerUserId: owner,
        runId,
        deliverySequence,
        expectedGeneration,
        reason,
      }),
    );

  it('fences and persists every binding transition and delivery state', async () => {
    const rootA = '/work/project-a';
    const rootB = '/work/project-b';
    const unbound: WorkspaceRow = {
      workspaceRoot: null,
      workspaceExecutorId: null,
      workspaceGeneration: 0,
      workspaceTold: null,
      workspaceToldFrom: null,
      workspaceDetachReason: null,
    };

    expect(
      await tenantDb.runAs(owner, (tx) =>
        new WorkspaceBindingRepository(tx).isCurrentDelivery({
          runId,
          ownerUserId: owner,
          deliverySequence: startedSequence,
        }),
      ),
    ).toBe(true);
    expect(await readWorkspace()).toEqual(unbound);
    expect(await readRun()).toEqual({ workerId: null });

    await expect(enter(rootA)).resolves.toEqual({
      status: 'bound',
      previousRoot: null,
      generation: 1,
    });
    expect(await readWorkspace()).toEqual({
      ...unbound,
      workspaceRoot: rootA,
      workspaceExecutorId: 'executor-a',
      workspaceGeneration: 1,
    });
    expect(await readRun()).toEqual({ workerId: 'executor-a' });

    await expect(enter(rootA)).resolves.toEqual({
      status: 'unchanged',
      previousRoot: rootA,
      generation: 1,
    });
    expect(await readWorkspace()).toEqual({
      ...unbound,
      workspaceRoot: rootA,
      workspaceExecutorId: 'executor-a',
      workspaceGeneration: 1,
    });

    await expect(enter(rootB)).resolves.toEqual({
      status: 'switched',
      previousRoot: rootA,
      generation: 2,
    });
    expect(await readWorkspace()).toEqual({
      ...unbound,
      workspaceRoot: rootB,
      workspaceExecutorId: 'executor-a',
      workspaceGeneration: 2,
    });

    await expect(exit()).resolves.toEqual({
      status: 'cleared',
      previousRoot: rootB,
      generation: 3,
    });
    expect(await readWorkspace()).toEqual({
      ...unbound,
      workspaceGeneration: 3,
    });

    await expect(exit()).resolves.toEqual({ status: 'unbound' });
    expect(await readWorkspace()).toEqual({
      ...unbound,
      workspaceGeneration: 3,
    });

    await expect(enter(rootA)).resolves.toEqual({
      status: 'bound',
      previousRoot: null,
      generation: 4,
    });
    expect(await readWorkspace()).toEqual({
      ...unbound,
      workspaceRoot: rootA,
      workspaceExecutorId: 'executor-a',
      workspaceGeneration: 4,
    });

    await expect(detach(3, 'permission_rejected')).resolves.toBe('stale');
    expect(await readWorkspace()).toEqual({
      ...unbound,
      workspaceRoot: rootA,
      workspaceExecutorId: 'executor-a',
      workspaceGeneration: 4,
    });

    await expect(detach(4, 'permission_rejected')).resolves.toBe('detached');
    expect(await readWorkspace()).toEqual({
      ...unbound,
      workspaceGeneration: 5,
      workspaceDetachReason: 'permission_rejected',
    });

    const superseding = await tenantDb.runAs(owner, async (tx) => {
      const restarted = await new RunsRepository(tx).markStarted(runId, owner);
      if (restarted === undefined) {
        throw new Error('Workspace binding integration Run did not restart');
      }
      return new RunEventsRepository(tx).append(runId, 'run.started');
    });
    expect(
      await tenantDb.runAs(owner, (tx) =>
        new WorkspaceBindingRepository(tx).isCurrentDelivery({
          runId,
          ownerUserId: owner,
          deliverySequence: startedSequence,
        }),
      ),
    ).toBe(false);
    expect(
      await tenantDb.runAs(owner, (tx) =>
        new WorkspaceBindingRepository(tx).isCurrentDelivery({
          runId,
          ownerUserId: owner,
          deliverySequence: superseding.sequence,
        }),
      ),
    ).toBe(true);

    const beforeSuperseded = await readWorkspace();
    await expect(enter(rootB, startedSequence)).resolves.toEqual({
      status: 'fence_lost',
    });
    expect(await readWorkspace()).toEqual(beforeSuperseded);
    expect(await readRun()).toEqual({ workerId: 'executor-a' });
  });
});
