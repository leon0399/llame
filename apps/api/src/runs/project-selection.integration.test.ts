/**
 * The durable Project selection, exercised against a real tenant-scoped
 * Postgres database as the non-superuser `app` role.
 *
 * Proves the invariant the worker depends on: a Run decides its Project
 * guidance before its first dispatch, records it write-once, and never reads
 * live Project rows again; a live read happens only before any dispatch and a
 * datastore/ownership problem fails closed instead of becoming "no Project".
 * Also proves the historical-presence query counts absorbed text-bearing
 * Project items without exposing another owner's Chat.
 */
import { and, eq, sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { ChatsRepository } from '../chats/chats-repository';
import { MessagesRepository } from '../chats/messages-repository';
import { type Project, messages, runEvents, runs } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ModelContextExecutionError } from './model-context-errors';
import { type ProjectBoundPayload } from './project-selection';
import {
  hasProjectContextHistory,
  recordRunProjectSelection,
  resolveRunProjectSelection,
} from './project-selection.repository';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { ProjectsRepository } from '../projects/projects-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];

if (!TEST_DB_URL) {
  throw new Error(
    'project-selection.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

const SECRET_INSTRUCTIONS = 'PRIVATE-INSTRUCTION-TEXT';

type SelectionRequest = { runId: string; chatId: string; userId: string };

type Harness = { tenantDb: TenantDbService };

async function errorOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;

    throw error;
  }

  throw new Error('Expected the operation to reject.');
}

function expectedSelection(project: Project): ProjectBoundPayload {
  return {
    v: 1,
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      instructions: project.instructions,
      locator: `projects://${project.id}`,
    },
  };
}

async function createUser(sql: Sql, label: string, runId: string) {
  const id = crypto.randomUUID();

  await sql`INSERT INTO users (id, name, email) VALUES (${id}, ${label}, ${`${label}-${runId}@test.com`})`;

  return id;
}

describe('Project selection persistence', () => {
  let sql: Sql;
  let harness: Harness;
  let ownerId = '';
  let otherId = '';
  const runTag = crypto.randomUUID();

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL) ? 'require' : false;

    sql = postgres(TEST_DB_URL, { ssl, max: 3 });
    harness = { tenantDb: new TenantDbService(drizzle({ client: sql })) };
    ownerId = await createUser(sql, 'Project selection owner', runTag);
    otherId = await createUser(sql, 'Project selection other', runTag);
  });

  afterAll(async () => {
    if (!sql) return;

    await sql`DELETE FROM users WHERE id IN (${ownerId}, ${otherId})`;
    await sql.end();
  });

  async function createProject(
    userId: string,
    fields: {
      name: string;
      description?: string | null;
      instructions?: string | null;
    },
  ): Promise<Project> {
    return harness.tenantDb.runAs(userId, async (tx) => {
      const projects = new ProjectsRepository(tx);

      const created = await projects.create({
        ownerUserId: userId,
        name: fields.name,
        description: fields.description ?? null,
      });

      if (fields.instructions === undefined) return created;

      const updated = await projects.update(created.id, userId, {
        instructions: fields.instructions,
      });

      return updated ?? created;
    });
  }

  async function createChat(userId: string, projectId?: string) {
    return harness.tenantDb.runAs(userId, async (tx) => {
      const chats = new ChatsRepository(tx);
      const chat = await chats.create({ ownerUserId: userId, title: 'Select' });

      if (projectId === undefined) return chat;

      const filed = await chats.update(chat.id, userId, { projectId });

      return filed ?? chat;
    });
  }

  async function fileChat(
    userId: string,
    chatId: string,
    projectId: string | null,
  ) {
    await harness.tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).update(chatId, userId, { projectId }),
    );
  }

  async function createRun(userId: string, chatId: string) {
    return harness.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).create({
        chatId,
        messageId: null,
        userId,
        modelId: 'system:test',
      }),
    );
  }

  function resolve(request: SelectionRequest) {
    return harness.tenantDb.runAs(request.userId, (tx) =>
      resolveRunProjectSelection(tx, request),
    );
  }

  function record(request: SelectionRequest, selection: ProjectBoundPayload) {
    return harness.tenantDb.runAs(request.userId, (tx) =>
      recordRunProjectSelection(
        tx,
        { runId: request.runId, userId: request.userId },
        selection,
      ),
    );
  }

  async function boundEventCount(userId: string, runId: string) {
    return harness.tenantDb.runAs(userId, async (tx) => {
      const [row] = await tx
        .select({ count: drizzleSql<number>`count(*)::int` })
        .from(runEvents)
        .where(
          and(
            eq(runEvents.runId, runId),
            eq(runEvents.eventType, 'run.project_bound'),
          ),
        );

      return row?.count ?? 0;
    });
  }

  async function messageCount(userId: string, chatId: string) {
    return harness.tenantDb.runAs(userId, async (tx) => {
      const [row] = await tx
        .select({ count: drizzleSql<number>`count(*)::int` })
        .from(messages)
        .where(eq(messages.chatId, chatId));

      return row?.count ?? 0;
    });
  }

  it('selects the current owned Project before the first dispatch', async () => {
    const project = await createProject(ownerId, {
      name: 'Alpha',
      description: 'First Project',
      instructions: 'Use the Alpha conventions.',
    });

    const chat = await createChat(ownerId, project.id);
    const run = await createRun(ownerId, chat.id);
    const request = { runId: run.id, chatId: chat.id, userId: ownerId };

    await expect(resolve(request)).resolves.toEqual(expectedSelection(project));
    await expect(resolve(request)).resolves.toEqual(expectedSelection(project));
  });

  it('sees a move that happens after queueing and before preparation', async () => {
    const alpha = await createProject(ownerId, { name: 'Queued Alpha' });

    const beta = await createProject(ownerId, {
      name: 'Queued Beta',
      instructions: 'Beta guidance',
    });

    const chat = await createChat(ownerId, alpha.id);
    const run = await createRun(ownerId, chat.id);

    await fileChat(ownerId, chat.id, beta.id);

    await expect(
      resolve({ runId: run.id, chatId: chat.id, userId: ownerId }),
    ).resolves.toEqual(expectedSelection(beta));
  });

  it('restores the committed selection after edits, a move, and deletion', async () => {
    const alpha = await createProject(ownerId, {
      name: 'Bound Alpha',
      description: 'Bound description',
      instructions: 'Bound guidance',
    });

    const beta = await createProject(ownerId, { name: 'Bound Beta' });
    const chat = await createChat(ownerId, alpha.id);
    const run = await createRun(ownerId, chat.id);
    const request = { runId: run.id, chatId: chat.id, userId: ownerId };
    const bound = await resolve(request);

    await record(request, bound);

    await harness.tenantDb.runAs(ownerId, (tx) =>
      new ProjectsRepository(tx).update(alpha.id, ownerId, {
        instructions: 'Edited after dispatch',
      }),
    );
    await fileChat(ownerId, chat.id, beta.id);
    await harness.tenantDb.runAs(ownerId, (tx) =>
      new ProjectsRepository(tx).delete(alpha.id, ownerId),
    );

    // No live lookup: the edited, moved-away, then deleted Project is still
    // exactly what this Run selected.
    await expect(resolve(request)).resolves.toEqual(expectedSelection(alpha));

    // A later Run resolves current state anew. The first Run has reached its
    // terminal state (the one-inflight-Run rule), not been rebound.
    await harness.tenantDb.runAs(ownerId, (tx) =>
      tx
        .update(runs)
        .set({ status: 'completed' })
        .where(and(eq(runs.id, run.id), eq(runs.userId, ownerId))),
    );
    const next = await createRun(ownerId, chat.id);

    await expect(
      resolve({ runId: next.id, chatId: chat.id, userId: ownerId }),
    ).resolves.toEqual(expectedSelection(beta));
  });

  it('restores a recorded null selection without inquiring live', async () => {
    const project = await createProject(ownerId, { name: 'Hidden Alpha' });
    const chat = await createChat(ownerId, project.id);
    const run = await createRun(ownerId, chat.id);
    const request = { runId: run.id, chatId: chat.id, userId: ownerId };

    await harness.tenantDb.runAs(ownerId, (tx) =>
      new RunEventsRepository(tx).append(run.id, 'run.project_bound', {
        v: 1,
        project: null,
      }),
    );

    await expect(resolve(request)).resolves.toEqual({
      v: 1,
      project: null,
    });
  });

  it('records one event, is idempotent, and refuses a rebind', async () => {
    const alpha = await createProject(ownerId, {
      name: 'Stable Alpha',
      instructions: 'Stable guidance',
    });

    const beta = await createProject(ownerId, { name: 'Other Beta' });
    const chat = await createChat(ownerId, alpha.id);
    const run = await createRun(ownerId, chat.id);
    const request = { runId: run.id, chatId: chat.id, userId: ownerId };
    const selection = await resolve(request);

    await record(request, selection);
    await record(request, selection);

    await expect(boundEventCount(ownerId, run.id)).resolves.toBe(1);
    await expect(resolve(request)).resolves.toEqual(selection);

    const rebind = expectedSelection(beta);
    const error = await errorOf(record(request, rebind));

    expect(error).toBeInstanceOf(ModelContextExecutionError);
    await expect(boundEventCount(ownerId, run.id)).resolves.toBe(1);
    await expect(resolve(request)).resolves.toEqual(selection);
  });

  it('rejects a supplied selection that is well-typed but non-canonical', async () => {
    const chat = await createChat(ownerId);
    const run = await createRun(ownerId, chat.id);

    const forged: ProjectBoundPayload = {
      v: 1,
      project: {
        id: crypto.randomUUID(),
        name: 'Forged',
        description: null,
        instructions: SECRET_INSTRUCTIONS,
        locator: 'projects://not-the-id',
      },
    };

    const error = await errorOf(
      record({ runId: run.id, chatId: chat.id, userId: ownerId }, forged),
    );

    expect(error).toBeInstanceOf(ModelContextExecutionError);
    expect(error.message).not.toContain(SECRET_INSTRUCTIONS);
    await expect(boundEventCount(ownerId, run.id)).resolves.toBe(0);
  });

  it.each([
    ['availability-only dispatch', 'availability'],
    ['model.requested dispatch', 'requested'],
    ['completed dispatch', 'completed'],
  ])(
    'fails closed with no binding after a prior %s record',
    async (_case, kind) => {
      const project = await createProject(ownerId, { name: 'Prior Alpha' });
      const chat = await createChat(ownerId, project.id);
      const run = await createRun(ownerId, chat.id);

      await harness.tenantDb.runAs(ownerId, async (tx) => {
        if (kind === 'requested') {
          await new RunEventsRepository(tx).append(run.id, 'model.requested', {
            modelId: 'system:test',
          });

          return;
        }

        await tx
          .update(runs)
          .set(
            kind === 'completed'
              ? { status: 'completed' }
              : { turnToolAvailability: [] },
          )
          .where(and(eq(runs.id, run.id), eq(runs.userId, ownerId)));
      });

      const error = await errorOf(
        resolve({ runId: run.id, chatId: chat.id, userId: ownerId }),
      );

      expect(error).toBeInstanceOf(ModelContextExecutionError);
      expect(error.message).not.toContain('Prior Alpha');
    },
  );

  it('refuses malformed and unsupported recorded payloads value-free', async () => {
    const project = await createProject(ownerId, { name: 'Corrupt Alpha' });
    const malformedChat = await createChat(ownerId, project.id);
    const unsupportedChat = await createChat(ownerId, project.id);
    const malformedRun = await createRun(ownerId, malformedChat.id);
    const unsupportedRun = await createRun(ownerId, unsupportedChat.id);

    const malformed = {
      v: 1,
      project: {
        id: project.id,
        name: project.name,
        description: null,
        instructions: SECRET_INSTRUCTIONS,
        locator: 'projects://wrong-id',
      },
    };

    await harness.tenantDb.runAs(ownerId, async (tx) => {
      const events = new RunEventsRepository(tx);

      await events.append(malformedRun.id, 'run.project_bound', malformed);
      await events.append(unsupportedRun.id, 'run.project_bound', {
        v: 2,
        project: null,
      });
    });

    for (const [runId, chatId] of [
      [malformedRun.id, malformedChat.id],
      [unsupportedRun.id, unsupportedChat.id],
    ]) {
      const error = await errorOf(resolve({ runId, chatId, userId: ownerId }));

      expect(error).toBeInstanceOf(ModelContextExecutionError);
      expect(error.message).not.toContain(SECRET_INSTRUCTIONS);
    }
  });

  it('treats a missing or foreign Chat and Run as failures, not null', async () => {
    const project = await createProject(ownerId, { name: 'Guarded Alpha' });
    const chat = await createChat(ownerId, project.id);
    const run = await createRun(ownerId, chat.id);
    const unfiledChat = await createChat(ownerId);
    const unfiledRun = await createRun(ownerId, unfiledChat.id);

    const wrongChat = await errorOf(
      resolve({
        runId: run.id,
        chatId: crypto.randomUUID(),
        userId: ownerId,
      }),
    );

    const foreignRun = await errorOf(
      resolve({
        runId: run.id,
        chatId: chat.id,
        userId: otherId,
      }),
    );

    const foreignChat = await errorOf(
      resolve({
        runId: unfiledRun.id,
        chatId: chat.id,
        userId: otherId,
      }),
    );

    for (const error of [wrongChat, foreignRun, foreignChat]) {
      expect(error).toBeInstanceOf(ModelContextExecutionError);
      expect(error.message).not.toContain('Guarded Alpha');
    }

    // A real unfiled Chat is the one case that resolves to null.
    await expect(
      resolve({
        runId: unfiledRun.id,
        chatId: unfiledChat.id,
        userId: ownerId,
      }),
    ).resolves.toEqual({ v: 1, project: null });
  });

  it("refuses to record on another owner's Run", async () => {
    const project = await createProject(ownerId, { name: 'Foreign Alpha' });
    const chat = await createChat(ownerId, project.id);
    const run = await createRun(ownerId, chat.id);

    const error = await errorOf(
      record(
        { runId: run.id, chatId: chat.id, userId: otherId },
        expectedSelection(project),
      ),
    );

    expect(error).toBeDefined();
    await expect(boundEventCount(ownerId, run.id)).resolves.toBe(0);
  });

  it('rolls back both the selection and staged context when dispatch fails', async () => {
    const alpha = await createProject(ownerId, {
      name: 'Rollback Alpha',
      instructions: 'Rollback guidance',
    });

    const chat = await createChat(ownerId);
    const run = await createRun(ownerId, chat.id);
    const request = { runId: run.id, chatId: chat.id, userId: ownerId };

    const aborted = await errorOf(
      harness.tenantDb.runAs(ownerId, async (tx) => {
        const selection = await resolveRunProjectSelection(tx, request);

        await recordRunProjectSelection(
          tx,
          { runId: run.id, userId: ownerId },
          selection,
        );
        await new MessagesRepository(tx).create({
          chatId: chat.id,
          role: 'user',
          senderUserId: ownerId,
          parts: [projectPart('Rollback guidance')],
        });

        throw new Error('dispatch aborted');
      }),
    );

    expect(aborted.message).toBe('dispatch aborted');
    await expect(boundEventCount(ownerId, run.id)).resolves.toBe(0);
    await expect(messageCount(ownerId, chat.id)).resolves.toBe(0);

    // The failed preparation froze nothing: the next attempt selects current
    // state, which is now Alpha.
    await fileChat(ownerId, chat.id, alpha.id);
    await expect(resolve(request)).resolves.toEqual(expectedSelection(alpha));
  });

  it('counts durable text-bearing Project context, including absorbed rows', async () => {
    const project = await createProject(ownerId, { name: 'History Alpha' });
    const withHistory = await createChat(ownerId, project.id);
    const withAbsorbed = await createChat(ownerId);
    const metadataOnly = await createChat(ownerId);
    const blankText = await createChat(ownerId);
    const otherProducer = await createChat(ownerId);

    await harness.tenantDb.runAs(ownerId, async (tx) => {
      const repo = new MessagesRepository(tx);

      await repo.create({
        chatId: withHistory.id,
        role: 'user',
        senderUserId: ownerId,
        parts: [projectPart('Project guidance')],
      });
      await repo.create({
        chatId: metadataOnly.id,
        role: 'user',
        senderUserId: ownerId,
        parts: [projectPart(undefined)],
      });
      await repo.create({
        chatId: blankText.id,
        role: 'user',
        senderUserId: ownerId,
        parts: [projectPart('  \n ')],
      });
      await repo.create({
        chatId: otherProducer.id,
        role: 'user',
        senderUserId: ownerId,
        parts: [projectPart('Workspace guidance', 'workspace')],
      });

      const absorbed = await repo.create({
        chatId: withAbsorbed.id,
        role: 'user',
        senderUserId: ownerId,
        parts: [projectPart('Absorbed guidance')],
      });

      await repo.create({
        chatId: withAbsorbed.id,
        role: 'checkpoint',
        parts: [{ type: 'text', text: 'Summary' }],
        absorbedThroughSeq: absorbed.seq,
      });
    });

    for (const chatId of [withHistory.id, withAbsorbed.id]) {
      await expect(
        harness.tenantDb.runAs(ownerId, (tx) =>
          hasProjectContextHistory(tx, chatId, ownerId),
        ),
      ).resolves.toBe(true);
    }

    for (const chatId of [metadataOnly.id, blankText.id, otherProducer.id]) {
      await expect(
        harness.tenantDb.runAs(ownerId, (tx) =>
          hasProjectContextHistory(tx, chatId, ownerId),
        ),
      ).resolves.toBe(false);
    }

    await expect(
      harness.tenantDb.runAs(otherId, (tx) =>
        hasProjectContextHistory(tx, withHistory.id, otherId),
      ),
    ).resolves.toBe(false);
  });
});

function projectPart(text: string | undefined, producer = 'project') {
  return {
    type: 'data-context',
    data: {
      v: 1,
      producer,
      form: 'snapshot',
      runId: 'run-context-fixture',
      payload: { v: 1, project: null },
      ...(text !== undefined && { text }),
    },
  };
}
