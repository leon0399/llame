import { randomUUID } from 'node:crypto';

import { isRecord, isString } from '@workspace/runtime-safety';
import { eq } from 'drizzle-orm';

import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { type ContextItemPart, isContextItemPart } from '../chats/context-item';
import { FollowUpAdmissionService } from '../chats/follow-up-admission.service';
import { createRunForMessage } from '../chats/run-creation';
import { type Message, runs } from '../db/schema';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { ModelsService } from '../models/models.service';
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
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { dispatchRun, seedRun } from './worker-harness';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'project-context.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

/** The slice of a provider message these scenarios read. */
type ProviderMessage = {
  role: string;
  content: string | ReadonlyArray<{ type: string; text?: string }>;
};

/** One flattened provider message: `role:text` or `role:<part type>`. */
function flatten(prompt: ReadonlyArray<ProviderMessage>): Array<string> {
  return prompt.flatMap(({ role, content }) =>
    isString(content)
      ? [`${role}:${content}`]
      : content.map((part) =>
          part.type === 'text'
            ? `${role}:${part.text}`
            : `${role}:${part.type}`,
        ),
  );
}

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

describe('project context binds at execution preparation', () => {
  const fx = useSegmentsFixture('project-context', {
    allowedTools: ['read'],
    runsConcurrency: 1,
  });

  const modelIdFor = (tag: string) => `project-context-${tag}-${randomUUID()}`;

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

  const failureOf = async (runId: string) => {
    const event = (await fx.events(runId)).find(
      (candidate) => candidate.eventType === 'run.failed',
    );

    if (event === undefined || !isRecord(event.payload)) {
      throw new Error(`Run ${runId} recorded no run.failed payload.`);
    }

    return event.payload;
  };

  /** A new Run on an existing Chat, launched with one plain answer. */
  async function launchOnChat(
    chatId: string,
    text: string,
    answerText: string,
  ) {
    const modelId = modelIdFor('run');

    const seeded = await seedRun({
      tenantDb: fx.harness.tenantDb,
      userId: fx.userId,
      modelId,
      text,
      chatId,
    });

    return fx.launch({ ...seeded, modelId }, [answer(answerText)]);
  }

  it('a Run queued under A binds the Project the Chat has when execution begins', async () => {
    const projectA = await createProject({
      name: 'Plan A',
      instructions: 'Follow the Plan A instruction.',
    });

    const projectB = await createProject({
      name: 'Plan B',
      instructions: 'Follow the Plan B instruction.',
    });

    // One hanging Run occupies the only worker slot, so the queued Run cannot
    // pass admission while the owner is still moving the Chat.
    const blockerModelId = modelIdFor('blocker');
    fx.harness.models.register(blockerModelId, { kind: 'hang' });

    const blocker = await seedRun({
      tenantDb: fx.harness.tenantDb,
      userId: fx.userId,
      modelId: blockerModelId,
      text: 'Hold the only worker slot.',
    });

    await dispatchRun({
      queue: fx.harness.queue,
      ...blocker,
      userId: fx.userId,
      modelId: blockerModelId,
    });
    await waitFor(
      () =>
        fx.harness.models.streamCalls.some(
          (call) => call.modelId === blockerModelId,
        )
          ? true
          : undefined,
      20_000,
      'the blocking Run to reach its provider request',
    );

    const queued = await fx.seed('Ask while filed under Plan A.');
    await fileChat(queued.chatId, projectA.id);

    fx.harness.models.register(queued.modelId, {
      kind: 'step-script',
      steps: [answer('The queued Run executed after the move.')],
    });
    await dispatchRun({
      queue: fx.harness.queue,
      ...queued,
      userId: fx.userId,
    });

    // Admission is complete and the job is queued; nothing selected anything.
    expect(await fx.types(queued.runId)).not.toContain('run.project_bound');

    await fileChat(queued.chatId, projectB.id);
    const promptsBefore = fx.harness.models.prompts.length;

    const cancelled = await fx.db((tx) =>
      new RunsRepository(tx).requestCancel(blocker.runId, fx.userId),
    );

    expect(cancelled).toBeDefined();
    await fx.terminal(blocker.runId);

    const finished = await fx.terminal(queued.runId);
    expect(finished?.status).toBe('completed');

    const prompts = fx.harness.models.prompts
      .slice(promptsBefore)
      .map((prompt) => flatten(prompt));

    const request = prompts[0] ?? [];

    expect(await selectionOf(queued.runId)).toMatchObject({
      id: projectB.id,
      name: 'Plan B',
      instructions: 'Follow the Plan B instruction.',
      locator: `projects://${projectB.id}`,
    });
    expect(request.some((line) => line.includes('Plan B instruction'))).toBe(
      true,
    );
    expect(request.some((line) => line.includes('Plan A instruction'))).toBe(
      false,
    );

    const items = projectItems(await fx.messages(queued.chatId), queued.runId);
    expect(items).toHaveLength(1);
    expect(projectOfItem(items[0])).toMatchObject({
      id: projectB.id,
    });
  });

  it('a later Run resolves the latest Project state while earlier history stays literal', async () => {
    const projectA = await createProject({
      name: 'Plan A',
      instructions: 'First generation of A guidance.',
    });

    const first = await fx.seed('The first turn.');
    await fileChat(first.chatId, projectA.id);
    const firstRun = await fx.launch(first, [answer('First answer.')]);
    await fx.terminal(firstRun.runId);

    const projectB = await createProject({
      name: 'Plan B',
      description: 'The second Plan description.',
      instructions: 'Second generation of guidance.',
    });

    await fileChat(first.chatId, projectB.id);

    const second = await launchOnChat(
      first.chatId,
      'The second turn.',
      'Second answer.',
    );

    await fx.terminal(second.runId);

    expect(await selectionOf(second.runId)).toMatchObject({
      id: projectB.id,
      name: 'Plan B',
      description: 'The second Plan description.',
      instructions: 'Second generation of guidance.',
    });

    const request = second.prompts()[0] ?? [];
    expect(
      request.some((line) => line.includes('Second generation of guidance.')),
    ).toBe(true);
    expect(
      request.some((line) => line.includes('First generation of A guidance.')),
    ).toBe(true);

    const stored = await fx.messages(first.chatId);
    const firstItems = projectItems(stored, firstRun.runId);
    expect(firstItems).toHaveLength(1);
    expect(projectOfItem(firstItems[0])).toMatchObject({
      instructions: 'First generation of A guidance.',
    });
    expect(projectItems(stored, second.runId)).toHaveLength(1);
  });

  it('Continue admits from an unfinished reply and resolves current Project state', async () => {
    const project = await createProject({
      name: 'Continue Plan',
      instructions: 'Continue with the original guidance.',
    });

    const source = await fx.seed('Fail after a kept tool step.');
    await fileChat(source.chatId, project.id);

    // A real resumable source: one settled read step, then a provider stream
    // failure after partial text. Its reply is unfinished and keeps that read.
    const sourceRun = await fx.launch(source, [
      call('continue-kept-read', 'read', { path: fx.directory }),
      [
        { type: 'text', id: 'partial', text: 'The partial answer.' },
        { type: 'error', message: 'provider dropped the stream' },
      ],
    ]);

    const sourceFinished = await fx.terminal(sourceRun.runId);

    expect(sourceFinished?.status).toBe('failed');

    const updated = await fx.db((tx) =>
      new ProjectsRepository(tx).update(project.id, fx.userId, {
        instructions: 'Continue with the edited guidance.',
      }),
    );

    expect(updated).toBeDefined();

    // The production admission computes the kept parts, their step numbers,
    // and the usage replacement from the stored failed reply.
    const admission = new FollowUpAdmissionService(
      fx.harness.tenantDb,
      fx.harness.moduleRef.get(ModelsService, { strict: false }),
      fx.harness.moduleRef.get(InstanceConfigService, { strict: false }),
      fx.harness.dispatch,
    );

    const continued = await admission.admitFollowUpRun({
      chatId: source.chatId,
      userId: fx.userId,
      userMessageId: source.userMessage.id,
      request: { action: 'continue' },
    });

    const launched = await fx.launch(
      { ...continued, modelId: continued.modelId },
      [answer('The continued answer.')],
    );

    await fx.terminal(continued.runId);

    expect(await selectionOf(continued.runId)).toMatchObject({
      id: project.id,
      instructions: 'Continue with the edited guidance.',
    });
    expect(
      (launched.prompts()[0] ?? []).some((line) =>
        line.includes('Continue with the edited guidance.'),
      ),
    ).toBe(true);

    const items = projectItems(
      await fx.messages(source.chatId),
      continued.runId,
    );

    expect(items).toHaveLength(1);
    expect(projectOfItem(items[0])).toMatchObject({
      instructions: 'Continue with the edited guidance.',
    });

    // The kept call came from the stored reply, not from a re-executed step.
    const continuedEvent = (await fx.events(continued.runId)).find(
      (event) => event.eventType === 'run.continued',
    );

    expect(continuedEvent).toBeDefined();
    expect(JSON.stringify(continuedEvent?.payload)).toContain(
      'continue-kept-read',
    );
  });

  it('Regenerate resolves current Project state as a new Run', async () => {
    const projectA = await createProject({
      name: 'Regenerate Plan',
      instructions: 'The original regeneration guidance.',
    });

    const source = await fx.seed('Start the regenerated turn.');
    await fileChat(source.chatId, projectA.id);
    const sourceRun = await fx.launch(source, [answer('The first answer.')]);
    await fx.terminal(sourceRun.runId);

    const projectB = await createProject({
      name: 'Replacement Plan',
      instructions: 'The replacement guidance.',
    });

    await fileChat(source.chatId, projectB.id);

    const regenerated = await fx.db(async (tx) => {
      const trigger = await new MessagesRepository(tx).findById(
        source.chatId,
        fx.userId,
        source.userMessage.id,
      );

      if (!trigger) throw new Error('The Regenerate trigger was not found.');

      const { run } = await createRunForMessage(
        tx,
        {
          userId: fx.userId,
          chatId: source.chatId,
          modelId: source.modelId,
          selector: source.modelId,
          effort: undefined,
          selectedEffort: undefined,
          selectionRevision: null,
          permissionMode: 'default',
          targetRunId: randomUUID(),
          followUp: {
            action: 'regenerate',
            sourceRunId: source.runId,
            replacesUsage: true,
            notice: true,
          },
        },
        trigger,
      );

      return run;
    });

    const launched = await fx.launch({ ...source, runId: regenerated.id }, [
      answer('The regenerated answer.'),
    ]);

    await fx.terminal(regenerated.id);

    expect(await selectionOf(regenerated.id)).toMatchObject({
      id: projectB.id,
      instructions: 'The replacement guidance.',
    });
    expect(
      (launched.prompts()[0] ?? []).some((line) =>
        line.includes('The replacement guidance.'),
      ),
    ).toBe(true);
    expect(
      projectItems(await fx.messages(source.chatId), regenerated.id),
    ).toHaveLength(1);
  });

  it('an unchanged selection still records a durable binding and emits no duplicate item', async () => {
    const projectA = await createProject({
      name: 'Stable Plan',
      instructions: 'The stable guidance that must not repeat.',
    });

    const first = await fx.seed('The establishing turn.');
    await fileChat(first.chatId, projectA.id);
    const firstRun = await fx.launch(first, [answer('Established.')]);
    await fx.terminal(firstRun.runId);

    const second = await launchOnChat(
      first.chatId,
      'The unchanged turn.',
      'No duplicate guidance.',
    );

    await fx.terminal(second.runId);

    expect(await selectionOf(second.runId)).toMatchObject({
      id: projectA.id,
      instructions: 'The stable guidance that must not repeat.',
    });
    expect(
      projectItems(await fx.messages(first.chatId), second.runId),
    ).toHaveLength(0);

    const request = second.prompts()[0] ?? [];
    expect(
      request.filter((line) => line.includes(`projects://${projectA.id}`)),
    ).toHaveLength(1);
    expect(
      request.filter((line) =>
        line.includes('The stable guidance that must not repeat.'),
      ),
    ).toHaveLength(1);
  });

  it('a dispatched Run with no selection event fails closed before any provider call', async () => {
    const projectA = await createProject({
      name: 'Legacy Plan',
      instructions: 'The current row must not substitute.',
    });

    const seeded = await fx.seed('A Run that already dispatched.');
    await fileChat(seeded.chatId, projectA.id);

    // An existing dispatch record, and no selection event: a legacy Run.
    await fx.db((tx) =>
      new RunEventsRepository(tx).append(seeded.runId, 'model.requested', {
        attemptId: randomUUID(),
      }),
    );

    const promptsBefore = fx.harness.models.prompts.length;
    const launched = await fx.launch(seeded, [answer('Must never stream.')]);

    const finished = await fx.terminal(seeded.runId);
    expect(finished?.status).toBe('failed');
    expect(fx.harness.models.prompts.slice(promptsBefore)).toEqual([]);
    expect(launched.prompts()).toEqual([]);

    const failure = await failureOf(seeded.runId);
    expect(failure).toMatchObject({
      status: 'failed',
      code: 'model_context_incompatible',
    });
    expect(isString(failure['message'])).toBe(true);
    expect(failure['message']).not.toHaveLength(0);
    expect(JSON.stringify(failure)).not.toContain(
      'The current row must not substitute.',
    );
    expect(await fx.types(seeded.runId)).not.toContain('run.project_bound');
    expect(
      projectItems(await fx.messages(seeded.chatId), seeded.runId),
    ).toHaveLength(0);
  });

  it('a legacy availability-only dispatch record fails closed without substituting current rows', async () => {
    const projectA = await createProject({
      name: 'Availability Plan',
      instructions: 'The availability record proves dispatch on its own.',
    });

    const seeded = await fx.seed('A pre-project-event dispatched Run.');
    await fileChat(seeded.chatId, projectA.id);

    // `dispatchedRunPredicate()`: turn availability, no model.requested event.
    await fx.db((tx) =>
      tx
        .update(runs)
        .set({ turnToolAvailability: [] })
        .where(eq(runs.id, seeded.runId)),
    );

    const promptsBefore = fx.harness.models.prompts.length;
    await fx.launch(seeded, [answer('Must never stream.')]);

    const finished = await fx.terminal(seeded.runId);
    expect(finished?.status).toBe('failed');
    expect(fx.harness.models.prompts.slice(promptsBefore)).toEqual([]);

    const failure = await failureOf(seeded.runId);
    expect(failure).toMatchObject({
      status: 'failed',
      code: 'model_context_incompatible',
    });
    expect(isString(failure['message'])).toBe(true);
    expect(failure['message']).not.toHaveLength(0);
    expect(JSON.stringify(failure)).not.toContain(
      'The availability record proves dispatch on its own.',
    );
    expect(await fx.types(seeded.runId)).not.toContain('run.project_bound');
    expect(
      projectItems(await fx.messages(seeded.chatId), seeded.runId),
    ).toHaveLength(0);
  });

  it('a malformed bound selection fails closed before any provider call', async () => {
    const projectA = await createProject({
      name: 'Malformed Plan',
      instructions: 'This selection must not dispatch.',
    });

    const seeded = await fx.seed('A Run with an invalid binding.');
    await fileChat(seeded.chatId, projectA.id);

    await fx.db((tx) =>
      new RunEventsRepository(tx).append(seeded.runId, 'run.project_bound', {
        v: 1,
        project: {
          id: projectA.id,
          name: 'Malformed Plan',
          description: null,
          instructions: 'Malformed selection instructions.',
          locator: `projects://${randomUUID()}`,
        },
      }),
    );

    const promptsBefore = fx.harness.models.prompts.length;
    await fx.launch(seeded, [answer('Must never stream.')]);

    const finished = await fx.terminal(seeded.runId);
    expect(finished?.status).toBe('failed');
    expect(fx.harness.models.prompts.slice(promptsBefore)).toEqual([]);

    const failure = await failureOf(seeded.runId);
    expect(failure).toMatchObject({
      status: 'failed',
      code: 'model_context_incompatible',
    });
    expect(isString(failure['message'])).toBe(true);
    expect(failure['message']).not.toHaveLength(0);
    expect(JSON.stringify(failure)).not.toContain(
      'Malformed selection instructions.',
    );
    expect(JSON.stringify(failure)).not.toContain(
      'This selection must not dispatch.',
    );
    expect(
      projectItems(await fx.messages(seeded.chatId), seeded.runId),
    ).toHaveLength(0);
  });

  it('Project instructions cannot grant a tool the operator did not admit', async () => {
    const project = await createProject({
      name: 'Tool Plan',
      instructions:
        'Always call the bash tool and the edit tool before answering.',
    });

    const seeded = await fx.seed('Answer without extra tools granted.');
    await fileChat(seeded.chatId, project.id);

    const started = await fx.launch(seeded, [answer('The policy answer.')]);
    await fx.terminal(seeded.runId);

    expect(
      (started.prompts()[0] ?? []).some((line) =>
        line.includes('Always call the bash tool'),
      ),
    ).toBe(true);

    const declaration = fx.harness.models.declarations.find(
      (entry) => entry.modelId === seeded.modelId,
    );

    const toolIds = (declaration?.tools ?? []).map((tool) => tool.toolId);

    expect(toolIds).toContain('read');
    expect(toolIds).not.toContain('bash');
    expect(toolIds).not.toContain('edit');
  });

  it('a Project supplies guidance without claiming a Workspace binding', async () => {
    const project = await createProject({
      name: 'Workspace-free Plan',
      instructions: 'Work only through the tools you already have.',
    });

    const seeded = await fx.seed('The Workspace-free turn.');
    await fileChat(seeded.chatId, project.id);

    await fx.launch(seeded, [answer('Answered without a Workspace.')]);
    await fx.terminal(seeded.runId);

    const messages = await fx.messages(seeded.chatId);
    const items = projectItems(messages, seeded.runId);

    expect(items).toHaveLength(1);
    expect(
      messages.flatMap((message) =>
        message.parts.filter(
          (part) =>
            isContextItemPart(part) && part.data.producer === 'workspace',
        ),
      ),
    ).toHaveLength(0);

    const chat = await fx.db((tx) =>
      new ChatsRepository(tx).findById(seeded.chatId, fx.userId),
    );

    expect(chat?.workspaceRoot).toBeNull();
  });
});
