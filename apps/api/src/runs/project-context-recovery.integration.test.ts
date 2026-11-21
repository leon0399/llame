import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { eq, sql } from 'drizzle-orm';

import { ChatsRepository } from '../chats/chats-repository';
import { type ContextItemPart, isContextItemPart } from '../chats/context-item';
import { CompactionService } from '../compaction/compaction.service';
import { type Message, runs } from '../db/schema';
import { ProviderFailure } from '../models/provider-failure/provider-failure';
import { ProjectsRepository } from '../projects/projects-repository';
import { waitFor } from '../testing/support';
import {
  answer,
  call,
  useSegmentsFixture,
} from '../testing/run-segments.test-fixture';
import {
  parseProjectBoundPayload,
  type ProjectSelection,
} from './project-selection';
import { RunWaitService } from './run-wait.service';
import { dispatchRun, seedRun } from './worker-harness';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'project-context-recovery.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

/** The Project a parsed selection payload names, or null for absence. */
function projectOfItem(
  item: ContextItemPart | undefined,
): ProjectSelection | null {
  if (item === undefined) throw new Error('Expected a stored Project item.');

  const selection = parseProjectBoundPayload(item.data.payload);

  if (selection === undefined) {
    throw new Error('The stored Project item has a malformed payload.');
  }

  return selection.project;
}

describe('a dispatched Run keeps its Project selection through recovery', () => {
  const fx = useSegmentsFixture('project-recovery', {
    allowedTools: ['read'],
  });

  const requestUsage = (inputTokens: number) => ({
    inputTokens: {
      total: inputTokens,
      noCache: inputTokens,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  });

  const quotaFailure = () =>
    new ProviderFailure('The provider quota is exhausted.', {
      code: 'quota_exhausted',
      resetsAt: Date.now() + 120_000,
      statusCode: 429,
    });

  async function createProject(input: {
    name: string;
    description?: string | null;
    instructions?: string | null;
  }) {
    return fx.db(async (tx) => {
      const repository = new ProjectsRepository(tx);

      const created = await repository.create({
        ownerUserId: fx.userId,
        name: input.name,
        description: input.description ?? null,
      });

      const updated =
        input.instructions === undefined
          ? created
          : await repository.update(created.id, fx.userId, {
              instructions: input.instructions,
            });

      if (!updated) throw new Error(`Could not seed Project ${input.name}`);

      return updated;
    });
  }

  const replaceInstructions = async (
    projectId: string,
    instructions: string,
  ) => {
    const updated = await fx.db((tx) =>
      new ProjectsRepository(tx).update(projectId, fx.userId, { instructions }),
    );

    if (!updated) throw new Error(`Project ${projectId} was not updated`);
  };

  const fileChat = (chatId: string, projectId: string | null) =>
    fx.db(async (tx) => {
      const updated = await new ChatsRepository(tx).update(chatId, fx.userId, {
        projectId,
      });

      if (!updated) throw new Error(`Chat ${chatId} was not filed`);

      return updated;
    });

  const projectItems = (messages: ReadonlyArray<Message>, runId?: string) =>
    messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        isContextItemPart(part) &&
        part.data.producer === 'project' &&
        (runId === undefined || part.data.runId === runId)
          ? [part]
          : [],
      ),
    );

  const selectionOf = async (
    runId: string,
  ): Promise<ProjectSelection | null> => {
    const event = (await fx.events(runId)).find(
      (candidate) => candidate.eventType === 'run.project_bound',
    );

    if (event === undefined) {
      throw new Error(`Run ${runId} recorded no run.project_bound event.`);
    }

    const selection = parseProjectBoundPayload(event.payload);

    if (selection === undefined) {
      throw new Error(`Run ${runId} recorded a malformed selection payload.`);
    }

    return selection.project;
  };

  async function awaitingQuota(runId: string, resumeAt?: string) {
    return waitFor(
      async () => {
        const run = await fx.run(runId);

        if (
          run?.status === 'awaiting_quota' &&
          run.awaiting?.kind === 'quota' &&
          (resumeAt === undefined || run.awaiting.resumeAt === resumeAt)
        )
          return run;

        return undefined;
      },
      20_000,
      `Run ${runId} to await quota${resumeAt ? ` at ${resumeAt}` : ''}`,
    );
  }

  async function wakeQuota(runId: string) {
    const suspended = await fx.run(runId);

    if (
      suspended?.status !== 'awaiting_quota' ||
      suspended.awaiting?.kind !== 'quota'
    )
      throw new Error(`Run ${runId} is not awaiting quota.`);

    const { awaiting, wakeGeneration } = suspended;

    await fx.db((tx) =>
      tx
        .update(runs)
        .set({ awaiting: { ...awaiting, wakeAt: new Date(0).toISOString() } })
        .where(eq(runs.id, runId)),
    );

    return fx.db((tx) =>
      fx.harness.moduleRef.get(RunWaitService).wakeInTransaction(tx, {
        runId,
        userId: fx.userId,
        generation: wakeGeneration,
        cause: 'timeout',
      }),
    );
  }

  function summaryOnce() {
    let calls = 0;

    const summarize = vi
      .spyOn(fx.harness.moduleRef.get(CompactionService), 'summarizeCheckpoint')
      .mockImplementation((input) => {
        calls += 1;

        if (calls === 1) return Promise.reject(quotaFailure());

        return Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'A persisted summary of prior conversation history.',
          usage: {},
        });
      });

    summarize.mockClear();

    return summarize;
  }

  function summaryOnThreshold() {
    const summarize = vi
      .spyOn(fx.harness.moduleRef.get(CompactionService), 'summarizeCheckpoint')
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'A persisted summary of prior conversation history.',
          usage: {},
        }),
      );

    summarize.mockClear();

    return summarize;
  }

  function boundarySummary() {
    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'A persisted step-boundary summary.',
          usage: {},
        }),
      );

    summarize.mockClear();

    return summarize;
  }

  const checkpoints = async (chatId: string) =>
    (await fx.messages(chatId)).filter(
      (message) => message.role === 'checkpoint',
    );

  const toolFile = () => join(fx.directory, 'recovery-context.txt');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('an edit and a move after dispatch keep the selected guidance for the next step', async () => {
    await writeFile(toolFile(), 'readable tool output\n');

    const projectA = await createProject({
      name: 'Selected Plan',
      instructions: 'The guidance selected at dispatch.',
    });

    const projectB = await createProject({
      name: 'Live Plan',
      instructions: 'The live edit that must not apply.',
    });

    const seeded = await fx.seed('Read, then answer after the owner edits.');
    await fileChat(seeded.chatId, projectA.id);

    const started = await fx.launch(
      seeded,
      [
        call('read-before-edit', 'read', { path: toolFile() }),
        answer('The step after the edit.'),
      ],
      async (index) => {
        if (index !== 1) return;

        await replaceInstructions(
          projectA.id,
          'The live edit that must not apply.',
        );
        await fileChat(seeded.chatId, projectB.id);
      },
    );

    await fx.terminal(seeded.runId);

    expect(started.prompts()).toHaveLength(2);
    expect(
      (started.prompts()[1] ?? []).some((line) =>
        line.includes('The guidance selected at dispatch.'),
      ),
    ).toBe(true);
    expect(
      (started.prompts()[1] ?? []).some((line) =>
        line.includes('The live edit that must not apply.'),
      ),
    ).toBe(false);
    expect(await selectionOf(seeded.runId)).toMatchObject({ id: projectA.id });

    const items = projectItems(await fx.messages(seeded.chatId), seeded.runId);
    expect(items).toHaveLength(1);
    expect(projectOfItem(items[0])).toMatchObject({
      instructions: 'The guidance selected at dispatch.',
    });
  });

  it('unfiling and deleting the Project after dispatch keeps the selected guidance', async () => {
    await writeFile(toolFile(), 'readable tool output\n');

    const project = await createProject({
      name: 'Deletion Plan',
      instructions: 'The guidance that survives deletion.',
    });

    const seeded = await fx.seed('Read, then answer after the Project dies.');
    await fileChat(seeded.chatId, project.id);

    const started = await fx.launch(
      seeded,
      [
        call('read-before-delete', 'read', { path: toolFile() }),
        answer('The step after deletion.'),
      ],
      async (index) => {
        if (index !== 1) return;

        const deleted = await fx.db((tx) =>
          new ProjectsRepository(tx).delete(project.id, fx.userId),
        );

        expect(deleted).toBe(true);
      },
    );

    await fx.terminal(seeded.runId);

    expect(started.prompts()).toHaveLength(2);
    expect(
      (started.prompts()[1] ?? []).some((line) =>
        line.includes('The guidance that survives deletion.'),
      ),
    ).toBe(true);
    expect(await selectionOf(seeded.runId)).toMatchObject({ id: project.id });

    const chat = await fx.db((tx) =>
      new ChatsRepository(tx).findById(seeded.chatId, fx.userId),
    );

    expect(chat?.projectId).toBeNull();
  });

  it('a steer after a move keeps the selected guidance in the steered request', async () => {
    await writeFile(toolFile(), 'readable tool output\n');

    const projectA = await createProject({
      name: 'Steered Plan',
      instructions: 'The guidance before the steer.',
    });

    const projectB = await createProject({
      name: 'Steer Move Plan',
      instructions: 'The guidance after the move.',
    });

    const seeded = await fx.seed('Read, then receive a steer.');
    await fileChat(seeded.chatId, projectA.id);

    const started = await fx.launch(
      seeded,
      [
        call('read-before-steer', 'read', { path: toolFile() }),
        answer('The steered answer.'),
      ],
      async (index) => {
        if (index !== 0) return;

        await fileChat(seeded.chatId, projectB.id);
        await fx.storeItems(
          seeded.chatId,
          ['Take the steered direction.'],
          'steer',
          seeded.runId,
        );
      },
    );

    await fx.terminal(seeded.runId);

    const steeredRequests = started
      .prompts()
      .map((request, index) => ({ index, text: request.join('\n') }))
      .filter(({ text }) => text.includes('Take the steered direction.'));

    expect(steeredRequests).toHaveLength(1);

    const [steered] = steeredRequests;

    if (steered === undefined) {
      throw new Error('The steered request was not sent.');
    }

    expect(steered.index).toBeGreaterThan(0);
    expect(steered.text).toContain('The guidance before the steer.');
    expect(steered.text).not.toContain('The guidance after the move.');
    expect(await selectionOf(seeded.runId)).toMatchObject({ id: projectA.id });
  });

  it('an interrupt after an edit keeps the selected guidance in the resumed request', async () => {
    const held = Promise.withResolvers<void>();

    const project = await createProject({
      name: 'Interrupted Plan',
      instructions: 'The guidance that survives the interrupt.',
    });

    const seeded = await fx.seed('Hold the response for an interrupt.');
    await fileChat(seeded.chatId, project.id);

    const started = await fx.launch(seeded, [
      [
        { type: 'text', id: 'partial', text: 'A partial response.' },
        { type: 'hold', onHeld: held.resolve },
      ],
      answer('The resumed answer.'),
    ]);

    await held.promise;

    await replaceInstructions(
      project.id,
      'The edited guidance after interrupt.',
    );
    await fx.storeItems(
      seeded.chatId,
      ['Stop and take this direction.'],
      'interrupt',
      seeded.runId,
    );

    await fx.terminal(seeded.runId);

    expect(started.prompts().length).toBeGreaterThanOrEqual(2);
    expect(
      (started.prompts()[1] ?? []).some((line) =>
        line.includes('The guidance that survives the interrupt.'),
      ),
    ).toBe(true);
    expect(
      (started.prompts()[1] ?? []).some((line) =>
        line.includes('The edited guidance after interrupt.'),
      ),
    ).toBe(false);
    expect(await selectionOf(seeded.runId)).toMatchObject({ id: project.id });
  });

  it('a quota wake after an edit keeps the selected guidance', async () => {
    const project = await createProject({
      name: 'Quota Plan',
      instructions: 'The guidance the woken request must retain.',
    });

    const seeded = await fx.seed('Suspend on quota, then answer.');
    await fileChat(seeded.chatId, project.id);

    let failed = false;

    const started = await fx.launch(
      seeded,
      [answer('The woken answer.')],
      () => {
        if (failed) return;

        failed = true;
        throw quotaFailure();
      },
    );

    await awaitingQuota(seeded.runId);

    await replaceInstructions(project.id, 'The edited guidance after quota.');

    expect(await wakeQuota(seeded.runId)).toBe(true);
    await fx.terminal(seeded.runId);

    const request = (started.prompts().at(-1) ?? []).join('\n');
    expect(request).toContain('The guidance the woken request must retain.');
    expect(request).not.toContain('The edited guidance after quota.');
    expect(await selectionOf(seeded.runId)).toMatchObject({ id: project.id });
  });

  it('a mid-Run checkpoint re-establishes the selected guidance, not the live edit', async () => {
    await writeFile(toolFile(), 'readable tool output\n');

    const project = await createProject({
      name: 'Checkpoint Plan',
      instructions: 'The selected guidance across the checkpoint.',
    });

    const seeded = await fx.seed('Read, compact, then answer.');
    await fileChat(seeded.chatId, project.id);

    const summarize = boundarySummary();

    const started = await fx.launch(
      seeded,
      [
        call('read-before-checkpoint', 'read', { path: toolFile() }),
        answer('The answer after the checkpoint.'),
      ],
      async (index) => {
        if (index === 1) {
          await replaceInstructions(
            project.id,
            'The live edit after the checkpoint.',
          );
        }
      },
      {
        compactionThresholdTokens: 1,
        requestUsages: [requestUsage(0), requestUsage(0)],
      },
    );

    await fx.terminal(seeded.runId);

    expect(summarize).toHaveBeenCalled();
    expect(await checkpoints(seeded.chatId)).toHaveLength(1);

    const postCheckpoint = (started.prompts().at(-1) ?? []).join('\n');
    expect(postCheckpoint).toContain(
      'The selected guidance across the checkpoint.',
    );
    expect(postCheckpoint).not.toContain('The live edit after the checkpoint.');
    expect(await selectionOf(seeded.runId)).toMatchObject({ id: project.id });
  });

  it('an unchanged selection records its binding and survives quota recovery without a live lookup', async () => {
    const project = await createProject({
      name: 'Recovery Plan',
      instructions: 'The guidance recovered from the binding.',
    });

    const first = await fx.seed('The establishing turn.');
    await fileChat(first.chatId, project.id);
    await fx.launch(first, [answer('Established.')]);
    await fx.terminal(first.runId);

    const modelId = `project-recovery-unchanged-${randomUUID()}`;

    const second = await seedRun({
      tenantDb: fx.harness.tenantDb,
      userId: fx.userId,
      modelId,
      text: 'Recover the unchanged selection.',
      chatId: first.chatId,
    });

    let failed = false;

    const started = await fx.launch(
      { ...second, modelId },
      [answer('The recovered answer.')],
      () => {
        if (failed) return;

        failed = true;
        throw quotaFailure();
      },
    );

    await awaitingQuota(second.runId);

    // The unchanged render emitted no new item, yet dispatch recorded a binding.
    expect(
      projectItems(await fx.messages(first.chatId), second.runId),
    ).toHaveLength(0);
    expect(await selectionOf(second.runId)).toMatchObject({
      id: project.id,
      instructions: 'The guidance recovered from the binding.',
    });

    await replaceInstructions(
      project.id,
      'The live guidance after suspension.',
    );

    expect(await wakeQuota(second.runId)).toBe(true);
    await fx.terminal(second.runId);

    const request = (started.prompts().at(-1) ?? []).join('\n');
    expect(request).toContain('The guidance recovered from the binding.');
    expect(request).not.toContain('The live guidance after suspension.');
    expect(
      projectItems(await fx.messages(first.chatId), second.runId),
    ).toHaveLength(0);
  });

  it('a pre-dispatch preparation failure freezes nothing and the next attempt selects current state', async () => {
    const prior = await fx.seed('Establish prior history for compaction.');
    await fx.launch(prior, [answer('The prior turn completed.')]);
    await fx.terminal(prior.runId);

    const projectA = await createProject({
      name: 'Preparation Plan A',
      instructions: 'The guidance of the failed preparation.',
    });

    const projectB = await createProject({
      name: 'Preparation Plan B',
      instructions: 'The guidance of the retried preparation.',
    });

    await fileChat(prior.chatId, projectA.id);

    const summarize = summaryOnce();
    const modelId = `project-recovery-preparation-${randomUUID()}`;

    const seeded = await seedRun({
      tenantDb: fx.harness.tenantDb,
      userId: fx.userId,
      modelId,
      text: 'Fail preparation, then retry after a move.',
      chatId: prior.chatId,
    });

    const started = await fx.launch(
      { ...seeded, modelId },
      [answer('Retried.')],
      undefined,
      {
        compactionThresholdTokens: 1,
      },
    );

    const suspended = await awaitingQuota(seeded.runId, 'preDispatch');
    expect(suspended.awaiting).toMatchObject({ kind: 'quota' });

    // No dispatch happened, so no binding exists yet.
    expect(await fx.types(seeded.runId)).not.toContain('run.project_bound');

    await fileChat(prior.chatId, projectB.id);
    expect(await wakeQuota(seeded.runId)).toBe(true);
    await fx.terminal(seeded.runId);

    expect(summarize).toHaveBeenCalledTimes(2);
    expect(await selectionOf(seeded.runId)).toMatchObject({ id: projectB.id });
    expect(
      projectItems(await fx.messages(prior.chatId), seeded.runId),
    ).toHaveLength(1);

    const request = (started.prompts().at(-1) ?? []).join('\n');
    expect(request).toContain('The guidance of the retried preparation.');
    expect(request).not.toContain('The guidance of the failed preparation.');
  });

  it('a checkpoint before a later Run re-establishes its current selection', async () => {
    const project = await createProject({
      name: 'Epoch Plan',
      instructions: 'The guidance of the new epoch.',
    });

    const first = await fx.seed('The turn a checkpoint will absorb.');
    await fileChat(first.chatId, project.id);
    await fx.launch(first, [answer('The absorbed turn.')]);
    await fx.terminal(first.runId);

    summaryOnThreshold();

    const modelId = `project-recovery-epoch-${randomUUID()}`;

    const second = await seedRun({
      tenantDb: fx.harness.tenantDb,
      userId: fx.userId,
      modelId,
      text: 'Start the new epoch.',
      chatId: first.chatId,
    });

    const started = await fx.launch(
      { ...second, modelId },
      [answer('New epoch.')],
      undefined,
      {
        compactionThresholdTokens: 1,
      },
    );

    await fx.terminal(second.runId);

    expect(await checkpoints(first.chatId)).toHaveLength(1);

    const items = projectItems(await fx.messages(first.chatId), second.runId);
    expect(items).toHaveLength(1);
    expect(projectOfItem(items[0])).toMatchObject({
      id: project.id,
      instructions: 'The guidance of the new epoch.',
    });

    const request = (started.prompts().at(-1) ?? []).join('\n');
    expect(request).toContain('The guidance of the new epoch.');
    expect(request).toContain(`projects://${project.id}`);

    const checkpoint = (await checkpoints(first.chatId))[0];
    expect(
      checkpoint?.parts.filter(
        (part) => isContextItemPart(part) && part.data.producer === 'project',
      ),
    ).toHaveLength(0);
  });

  it('a null selection after a checkpoint retires absorbed guidance with an absence snapshot', async () => {
    const project = await createProject({
      name: 'Absorbed Plan',
      instructions: 'The guidance that must be retired.',
    });

    const first = await fx.seed(
      'The turn a checkpoint will absorb with Project context.',
    );

    await fileChat(first.chatId, project.id);
    await fx.launch(first, [answer('The absorbed Project turn.')]);
    await fx.terminal(first.runId);

    const deleted = await fx.db((tx) =>
      new ProjectsRepository(tx).delete(project.id, fx.userId),
    );

    expect(deleted).toBe(true);

    summaryOnThreshold();

    const modelId = `project-recovery-absence-${randomUUID()}`;

    const second = await seedRun({
      tenantDb: fx.harness.tenantDb,
      userId: fx.userId,
      modelId,
      text: 'A turn with no Project after a checkpoint.',
      chatId: first.chatId,
    });

    const started = await fx.launch(
      { ...second, modelId },
      [answer('No Project.')],
      undefined,
      {
        compactionThresholdTokens: 1,
      },
    );

    await fx.terminal(second.runId);

    expect(await checkpoints(first.chatId)).toHaveLength(1);
    expect(await selectionOf(second.runId)).toBeNull();

    const items = projectItems(await fx.messages(first.chatId), second.runId);
    expect(items).toHaveLength(1);
    expect(projectOfItem(items[0])).toBeNull();
    expect(items[0]?.data.text).not.toContain(
      'The guidance that must be retired.',
    );

    const request = (started.prompts().at(-1) ?? []).join('\n');
    expect(request).not.toContain('The guidance that must be retired.');
    expect(request).toContain('producer="project"');
  });

  it('a never-filed Chat publishes a checkpoint without inventing a Project reminder', async () => {
    const prior = await fx.seed('A never-filed conversation.');
    await fx.launch(prior, [answer('The never-filed turn.')]);
    await fx.terminal(prior.runId);

    summaryOnThreshold();

    const modelId = `project-recovery-never-filed-${randomUUID()}`;

    const second = await seedRun({
      tenantDb: fx.harness.tenantDb,
      userId: fx.userId,
      modelId,
      text: 'A never-filed turn after a checkpoint.',
      chatId: prior.chatId,
    });

    const started = await fx.launch(
      { ...second, modelId },
      [answer('Still no Project.')],
      undefined,
      {
        compactionThresholdTokens: 1,
      },
    );

    await fx.terminal(second.runId);

    expect(await checkpoints(prior.chatId)).toHaveLength(1);
    expect(await selectionOf(second.runId)).toBeNull();
    expect(
      projectItems(await fx.messages(prior.chatId), second.runId),
    ).toHaveLength(0);
    expect((started.prompts().at(-1) ?? []).join('\n')).not.toContain(
      'producer="project"',
    );
  });

  it('a failed dispatch transaction stores neither the binding nor the snapshot and freezes nothing', async () => {
    const projectA = await createProject({
      name: 'Rollback Plan A',
      instructions: 'The guidance a rolled-back dispatch must not store.',
    });

    const projectB = await createProject({
      name: 'Rollback Plan B',
      instructions: 'The guidance the later Run must select.',
    });

    const seeded = await fx.seed(
      'Dispatch, fail after staging, then run later.',
    );

    await fileChat(seeded.chatId, projectA.id);

    // Fail the dispatch transaction at its final write, after the selection
    // event and staged snapshot already ran inside it. The trigger is scoped to
    // this Run, so concurrent suites never observe it, and removing it in the
    // `finally` keeps the shared table clean even when an assertion throws.
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const functionName = `test_project_dispatch_rollback_${suffix}`;

    await fx.harness.db.execute(
      sql.raw(`
        CREATE FUNCTION ${functionName}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.run_id = '${seeded.runId}'::uuid
            AND NEW.event_type = 'model.requested' THEN
            RAISE EXCEPTION 'Injected model.requested insert failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `),
    );
    await fx.harness.db.execute(
      sql.raw(`
        CREATE TRIGGER ${functionName}
        BEFORE INSERT ON run_events
        FOR EACH ROW EXECUTE FUNCTION ${functionName}()
      `),
    );

    const promptsBefore = fx.harness.models.prompts.length;

    fx.harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps: [answer('Must never stream.')],
    });

    try {
      await dispatchRun({
        queue: fx.harness.queue,
        ...seeded,
        userId: fx.userId,
        enqueueOptions: {
          retryLimit: 0,
        },
      });

      await fx.terminal(seeded.runId);

      expect(fx.harness.models.prompts.slice(promptsBefore)).toEqual([]);
      expect(await fx.types(seeded.runId)).not.toContain('run.project_bound');
      expect(
        projectItems(await fx.messages(seeded.chatId), seeded.runId),
      ).toHaveLength(0);
    } finally {
      await fx.harness.db.execute(
        sql.raw(`DROP TRIGGER IF EXISTS ${functionName} ON run_events`),
      );
      await fx.harness.db.execute(
        sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`),
      );
    }

    await fileChat(seeded.chatId, projectB.id);
    const modelId = `project-recovery-rollback-${randomUUID()}`;

    const later = await seedRun({
      tenantDb: fx.harness.tenantDb,
      userId: fx.userId,
      modelId,
      text: 'The Run after the rollback.',
      chatId: seeded.chatId,
    });

    const launched = await fx.launch({ ...later, modelId }, [
      answer('Later answer.'),
    ]);

    await fx.terminal(later.runId);

    expect(await selectionOf(later.runId)).toMatchObject({ id: projectB.id });
    expect(
      (launched.prompts()[0] ?? []).some((line) =>
        line.includes('The guidance the later Run must select.'),
      ),
    ).toBe(true);
    expect(
      projectItems(await fx.messages(seeded.chatId), later.runId),
    ).toHaveLength(1);
  });
});
