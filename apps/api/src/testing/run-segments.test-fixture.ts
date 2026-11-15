/**
 * The harness, owner, and helpers the run-steering integration suites share
 * (segments, interrupt): one worker harness booted around a `describeIfDb`
 * block, with the pending-item store, event, transcript, and Run-launch
 * helpers. Imported by `*.integration.test.ts` files only.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { MessagesRepository } from '../chats/chats-repository';
import { type ChatDeliveryMode } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { waitFor } from './support';
import { notifyRunControl } from '../runs/run-control';
import { isTerminalRunStatus } from '../runs/run-status';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { type ScriptedStep } from '../runs/scripted-model-step';
import {
  bootWorkerHarness,
  createUser,
  dispatchRun,
  seedRun,
  type WorkerHarness,
} from '../runs/worker-harness';

export const answer = (text: string): ScriptedStep => [
  { type: 'text', id: 't', text },
];

export const call = (
  toolCallId: string,
  toolName: string,
  input: UnknownRecord,
): ScriptedStep => [{ type: 'tool-call', toolCallId, toolName, input }];

/** The slice of a provider message the scenarios read. */
export type ProviderMessage = {
  role: string;
  content: string | ReadonlyArray<{ type: string; text?: string }>;
};

/** One flattened provider message: `role:text` or `role:<part type>`. */
export function flatten(prompt: ReadonlyArray<ProviderMessage>): Array<string> {
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

export type SegmentFixtureOptions = NonNullable<
  Parameters<typeof bootWorkerHarness>[0]
>;

export type SeededRun = Awaited<ReturnType<typeof seedRun>> & {
  modelId: string;
};

/**
 * One worker harness, one owner, and a scratch directory for a `describeIfDb`
 * block, booted around it, with the helpers every scenario shares. The
 * helpers read the booted state when they are called.
 */
export function useSegmentsFixture(
  label: string,
  options: SegmentFixtureOptions,
) {
  let booted:
    | { harness: WorkerHarness; userId: string; directory: string }
    | undefined;

  const state = () => {
    if (!booted) throw new Error(`The ${label} fixture is not booted.`);

    return booted;
  };

  beforeAll(async () => {
    const harness = await bootWorkerHarness(options);
    booted = {
      harness,
      userId: await createUser(harness.db, label),
      directory: await mkdtemp(join(tmpdir(), `${label}-`)),
    };
  });

  afterAll(async () => {
    if (!booted) return;
    await booted.harness.close();
    await rm(booted.directory, { recursive: true, force: true });
  });

  const db = <T>(work: (tx: Db) => Promise<T>) =>
    state().harness.tenantDb.runAs(state().userId, work);

  /**
   * A pending item of the Chat, as admission stores it. With `notifyRunId`, the
   * run-control pointer goes out in the same transaction, as admission sends it.
   */
  async function storeItems(
    chatId: string,
    texts: ReadonlyArray<string>,
    mode: Exclude<ChatDeliveryMode, 'notice'> = 'steer',
    notifyRunId?: string,
  ): Promise<Array<string>> {
    const ids: Array<string> = [];

    for (const text of texts) {
      const id = randomUUID();
      await db(async (tx) => {
        await new ChatDeliveriesRepository(tx).insertPending({
          id,
          chatId,
          ownerUserId: state().userId,
          mode,
          parts: [{ type: 'text', text }],
          settings: { modelId: 'ignored-by-steer', permissionMode: 'default' },
        });

        if (notifyRunId !== undefined && mode !== 'queue') {
          await notifyRunControl(tx, { runId: notifyRunId, kind: mode });
        }
      });
      ids.push(id);
    }

    return ids;
  }

  const items = (chatId: string) =>
    db((tx) =>
      new ChatDeliveriesRepository(tx).listPending(chatId, state().userId),
    );

  const itemState = (id: string) =>
    db((tx) => new ChatDeliveriesRepository(tx).findById(id, state().userId));

  const events = (runId: string) =>
    db((tx) => new RunEventsRepository(tx).listByRunId(runId, state().userId));

  const types = async (runId: string) =>
    (await events(runId)).map((event) => event.eventType);

  const run = (runId: string) =>
    db((tx) => new RunsRepository(tx).findById(runId, state().userId));

  const terminal = (runId: string) =>
    waitFor(
      async () => {
        const found = await run(runId);

        return found && isTerminalRunStatus(found.status) ? found : undefined;
      },
      40_000,
      `Run ${runId} to settle`,
    );

  const messages = (chatId: string) =>
    db((tx) => new MessagesRepository(tx).findByChatId(chatId, state().userId));

  /** The Chat in `seq` order, reduced to what the scenarios assert. */
  async function transcript(chatId: string) {
    return (await messages(chatId)).map((message) => ({
      id: message.id,
      role: message.role,
      inReplyTo: message.inReplyTo,
      text: message.parts
        .flatMap((part) =>
          isRecord(part) && part['type'] === 'text' && isString(part['text'])
            ? [part['text']]
            : [],
        )
        .join('|'),
      status:
        isRecord(message.usage) && isString(message.usage['status'])
          ? message.usage['status']
          : undefined,
      usage: message.usage,
    }));
  }

  /** `role:text` per message, the shape most scenarios compare. */
  const lines = async (chatId: string) =>
    (await transcript(chatId)).map(({ role, text }) => `${role}:${text}`);

  /** A Chat, its first message, and its Run, on a model named for the scenario. */
  async function seed(text = 'first message'): Promise<SeededRun> {
    const modelId = `${label}-${randomUUID()}`;

    const seeded = await seedRun({
      tenantDb: state().harness.tenantDb,
      userId: state().userId,
      modelId,
      text,
    });

    return { ...seeded, modelId };
  }

  /**
   * Scripts the Run's model and dispatches it; `beforeStep` may store items.
   * `prompts()` returns what the model was sent from here on, flattened.
   */
  async function launch(
    seeded: SeededRun,
    steps: ReadonlyArray<ScriptedStep>,
    beforeStep?: (stepIndex: number, seeded: SeededRun) => Promise<void> | void,
  ) {
    const { harness, userId } = state();
    harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps,
      ...(beforeStep !== undefined && {
        beforeStep: (index) => beforeStep(index, seeded),
      }),
    });
    const promptsBefore = harness.models.prompts.length;
    await dispatchRun({ queue: harness.queue, ...seeded, userId });

    return {
      ...seeded,
      prompts: () =>
        harness.models.prompts
          .slice(promptsBefore)
          .map((prompt) => flatten(prompt)),
    };
  }

  const startRun = async (
    steps: ReadonlyArray<ScriptedStep>,
    beforeStep?: (stepIndex: number, seeded: SeededRun) => Promise<void> | void,
  ) => launch(await seed(), steps, beforeStep);

  return {
    get harness() {
      return state().harness;
    },
    get userId() {
      return state().userId;
    },
    get directory() {
      return state().directory;
    },
    db,
    storeItems,
    items,
    itemState,
    events,
    types,
    run,
    terminal,
    messages,
    transcript,
    lines,
    seed,
    launch,
    startRun,
  };
}
