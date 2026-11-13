/**
 * A Continue Run's execution (turn-actions D1, D5, D6, D8, D11): the request it
 * sends resumes the kept steps of a failed reply, no kept call executes again,
 * the reply finalizes as kept parts then new parts, a failure before dispatch
 * changes nothing, kept parts that do not fit fail as context-incompatible, the
 * turn's rail keeps its stored items, and the usage names the Continue Run.
 *
 * TEST_DATABASE_URL-gated; run by test:integration with the other
 * .integration suites.
 */

import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { ModelMessage, ToolCallPart, ToolResultPart } from 'ai';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { and, eq } from 'drizzle-orm';
import {
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import * as schema from '../db/schema';
import { type Message, type Run } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { isContextItemPart } from '../chats/context-item';
import { createTemporalItem } from '../chats/context-item-producers';
import { type MessagePart } from '../chats/context-builder';
import { createRunForMessage } from '../chats/run-creation';

import {
  continuedCallSteps,
  continueStateFromEvents,
  withKeptSteps,
  type ContinuedEvent,
  type KeptStepNumbers,
} from '../chats/continue-projection';
import { RunningReplyRepository } from '../chats/running-reply-repository';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { type ModelClient } from '../models/model-client';
import { RunExecutionService } from '../runs/run-execution.service';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import {
  answerChunks,
  catalogEntry,
  catalogValidator,
  makeRunExecutionService,
  scriptedClient,
  scriptedModel,
} from '../testing/run-execution-integration-fixture';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

const MODEL_ID = 'mock';
const OTHER_MODEL_ID = 'mock-previous';
const MODEL_ENTRY = catalogEntry(MODEL_ID);
const USER_TEXT = 'Continue the work';
const KEPT_TEXT = 'reading the file';
const KEPT_RESULT = 'file body';
const CALL_ID = 'call-kept';

/** A settled `read` call, as the failed reply stored it. */
const keptParts: Array<MessagePart> = [
  { type: 'reasoning', text: 'I should read the file first' },
  { type: 'text', text: KEPT_TEXT },
  {
    type: 'tool-read',
    toolCallId: CALL_ID,
    state: 'output-available',
    input: { path: '/tmp/file.txt' },
    output: { status: 'success', path: '/tmp/file.txt', text: KEPT_RESULT },
    outcome: 'success',
  },
];

/** The same kept parts, with their call numbered step 1 (design D5). */
const keptPartsAtStepOne: Array<MessagePart> = [
  { type: 'reasoning', text: 'I should read the file first' },
  { type: 'text', text: KEPT_TEXT },
  {
    type: 'tool-read',
    toolCallId: CALL_ID,
    state: 'output-available',
    input: { path: '/tmp/file.txt' },
    output: { status: 'success', path: '/tmp/file.txt', text: KEPT_RESULT },
    outcome: 'success',
    step: 1,
  },
];

function failureChunks(afterText: string): Array<LanguageModelV3StreamPart> {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: afterText },
    { type: 'text-end', id: 'text' },
    { type: 'error', error: new Error('provider dropped the stream') },
  ];
}

describeIfDb('a Continue Run', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  let userId: string;
  let runExecution: RunExecutionService;

  const instanceConfig: InstanceConfigReader = {
    config: {
      ...BUILT_IN_DEFAULTS,
      models: [MODEL_ENTRY],
      runs: { ...BUILT_IN_DEFAULTS.runs, timeoutSeconds: 300 },
      tools: {
        ...BUILT_IN_DEFAULTS.tools,
        // One always-available tool, so this turn's catalog has a state the
        // earlier Run's record can differ from (turn-actions D8).
        allowed: ['search_conversations'],
      },
    },
  };

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL!, {
      max: 4,
      ssl: /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false,
    });
    tenantDb = new TenantDbService(drizzle({ client: sql }));
    userId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Continue run', ${`continue-run-${userId}@test.com`})`;

    runExecution = makeRunExecutionService({
      tenantDb,
      instanceConfig,
      models: catalogValidator([MODEL_ENTRY]),
    });
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });

  type ContinuedTurn = {
    chatId: string;
    messageId: string;
    runId: string;
    seq: number;
    /** The kept parts admission recorded, each numbered with its step. */
    keptParts: Array<unknown>;
  };

  /**
   * The source Run's own event log — the requests that number its calls, the
   * results it sent, and the extra step it made — and the step records the
   * Continue Run's admission derives from it.
   */
  async function seedSourceRecords(
    tx: Parameters<Parameters<TenantDbService['runAs']>[1]>[0],
    sourceRunId: string,
    sourceParts: ReadonlyArray<unknown>,
    options: Parameters<typeof seedContinuedTurn>[0],
  ): Promise<KeptStepNumbers> {
    const sourceEvents = new RunEventsRepository(tx);
    const sourceRecorded: Array<ContinuedEvent> = [];
    const steps = options?.keptSteps ?? [];

    const inherited = new Set(
      Object.keys(options?.sourceContinued?.steps ?? {}),
    );

    if (options?.sourceContinued !== undefined) {
      // A master-era Continue's own log: the parts it inherited, without a
      // `step`, and their numbers in the retired `steps` map.
      await sourceEvents.append(sourceRunId, 'run.continued', {
        sourceRunId: crypto.randomUUID(),
        parts: options.sourceContinued.parts,
        steps: options.sourceContinued.steps,
      });
    }

    let callIndex = 0;

    for (const part of sourceParts) {
      const record = keptResultOf(part);

      if (record === undefined) continue;

      // An inherited call was requested by the earlier Run, so the source Run
      // recorded no request of its own for it.
      if (inherited.has(record.toolCallId)) continue;

      const requested = {
        toolCallId: record.toolCallId,
        toolName: 'read',
        input: record.input,
        // The request that made the call is the one record of its step, so a
        // reply stored before parts recorded one keeps its boundaries (D5).
        stepNumber: steps[callIndex] ?? 0,
      };

      callIndex += 1;
      await sourceEvents.append(sourceRunId, 'tool.requested', requested);
      sourceRecorded.push({ eventType: 'tool.requested', payload: requested });

      const payload = {
        toolCallId: record.toolCallId,
        toolName: 'read',
        status: 'success',
        output: record.output,
      };

      await sourceEvents.append(sourceRunId, 'tool.completed', payload);
    }

    if (options?.chainedOwnCall === true) {
      const payload = {
        toolCallId: 'call-own',
        toolName: 'read',
        input: { path: '/tmp/second.txt' },
        stepNumber: 0,
      };

      await sourceEvents.append(sourceRunId, 'tool.requested', payload);
      sourceRecorded.push({ eventType: 'tool.requested', payload });
    }

    // SAFETY: the seeded reply parts are stored UI parts, and the projection
    // re-validates every part it reads.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    const keptParts = sourceParts as ReadonlyArray<MessagePart>;

    const sourceContinued = await sourceEvents.findFirstByType(
      sourceRunId,
      userId,
      'run.continued',
    );

    return continuedCallSteps({
      keptParts,
      ...(sourceContinued !== undefined && {
        sourceContinued: continueStateFromEvents([sourceContinued]),
      }),
      sourceEvents: sourceRecorded,
    });
  }

  /**
   * A turn whose source Run failed after one settled step, plus the Continue
   * Run admission would create for it — the same transaction path a follow-up
   * request uses, so the event log is real.
   */
  async function seedContinuedTurn(options?: {
    /** The source Run's recorded availability, which marks it dispatched. */
    sourceAvailability?: Array<{
      id: string;
      state: 'available' | 'unavailable';
    }>;
    replyParts?: Array<unknown>;
    previousReplyModelId?: string;
    temporalItem?: boolean;
    promptImportsItem?: boolean;
    /** One skill an earlier Run already activated on this turn. */
    skillActivationItem?: string;
    /** The step number each kept call's request recorded, in call order. */
    keptSteps?: ReadonlyArray<number>;
    /** Whether the source Run made a second read of its own. */
    chainedOwnCall?: boolean;
    /**
     * The `run.continued` event the source Run recorded itself: the parts it
     * inherited, without a `step`, and their numbers in the retired map.
     */
    sourceContinued?: {
      parts: ReadonlyArray<unknown>;
      steps: Readonly<Record<string, number>>;
    };
    /**
     * Whether the Continue Run was admitted before this change: its event
     * stores the kept parts without a `step` and their numbers in the retired
     * `steps` map, as master-era admission wrote them.
     */
    masterAdmitted?: boolean;
  }): Promise<ContinuedTurn> {
    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    return tenantDb.runAs(userId, async (tx) => {
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);
      const runsRepo = new RunsRepository(tx);
      await chatsRepo.createIfAbsent({
        id: chatId,
        ownerUserId: userId,
        title: 'Continue Run',
      });

      if (options?.previousReplyModelId !== undefined) {
        const earlier = await messagesRepo.create({
          chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'An earlier turn' }],
        });

        await messagesRepo.createAssistantReplyIfAbsent({
          chatId,
          inReplyTo: earlier.id,
          parts: [{ type: 'text', text: 'An earlier answer' }],
          usage: {
            status: 'completed',
            complete: true,
            runId: crypto.randomUUID(),
            modelId: options.previousReplyModelId,
          },
        });

        // A dispatched predecessor Run with its own record, so a baseline
        // lookup that ignored this message's earlier Run would read `[]` and
        // find no change (turn-actions D8).
        const previousRun = await runsRepo.create({
          chatId,
          messageId: earlier.id,
          userId,
          modelId: options.previousReplyModelId,
        });

        await runsRepo.markFinished(previousRun.id, userId, 'completed');
        await tx
          .update(schema.runs)
          .set({ turnToolAvailability: [] })
          .where(eq(schema.runs.id, previousRun.id));
      }

      // The items an earlier Run of this turn stored on its trigger, which the
      // Continue Run must keep rather than author again (turn-actions D8). The
      // source Run's id is generated here because its items name it and the
      // trigger has to exist before the Run row can reference it.
      const sourceRunId = crypto.randomUUID();
      const storedItems: Array<MessagePart> = [];

      if (options?.temporalItem === true) {
        storedItems.push(
          createTemporalItem({
            runId: sourceRunId,
            instant: new Date('2026-10-27T10:00:00.000Z'),
            timeZone: 'UTC',
          }),
        );
      }

      if (options?.promptImportsItem === true) {
        storedItems.push({
          type: 'data-context',
          data: {
            v: 1,
            producer: 'prompt-imports',
            runId: sourceRunId,
            payload: { entries: [] },
            text: 'stored import',
          },
        });
      }

      if (options?.skillActivationItem !== undefined) {
        storedItems.push({
          type: 'data-context',
          data: {
            v: 1,
            producer: 'skill-activation',
            runId: sourceRunId,
            payload: { kind: 'activation', skill: options.skillActivationItem },
            text: `$${options.skillActivationItem}`,
          },
        });
      }

      const text =
        options?.skillActivationItem === undefined
          ? USER_TEXT
          : `${USER_TEXT} $${options.skillActivationItem}`;

      const trigger = await messagesRepo.create({
        id: messageId,
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text }, ...storedItems],
      });

      const sourceRun = await runsRepo.create({
        id: sourceRunId,
        chatId,
        messageId,
        userId,
        modelId: MODEL_ID,
      });

      const sourceParts: Array<unknown> = options?.replyParts ?? keptParts;

      if (options?.sourceAvailability !== undefined) {
        await tx
          .update(schema.runs)
          .set({ turnToolAvailability: options.sourceAvailability })
          .where(eq(schema.runs.id, sourceRun.id));
      }

      await runsRepo.markFinished(sourceRun.id, userId, 'failed', {
        error: { message: 'the model dropped the stream' },
      });
      await messagesRepo.createAssistantReplyIfAbsent({
        chatId,
        inReplyTo: messageId,
        parts: sourceParts,
        usage: {
          status: 'error',
          complete: false,
          runId: sourceRun.id,
          modelId: MODEL_ID,
          attemptId: crypto.randomUUID(),
        },
      });

      const records = await seedSourceRecords(
        tx,
        sourceRun.id,
        sourceParts,
        options,
      );

      // SAFETY: the seeded reply parts are stored UI parts, and admission
      // re-validates every part it reads.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      const storedKeptParts = sourceParts as ReadonlyArray<MessagePart>;
      const numberedKeptParts = withKeptSteps(storedKeptParts, records);

      const { run } = await createRunForMessage(
        tx,
        {
          userId,
          chatId,
          modelId: MODEL_ID,
          effort: undefined,
          permissionMode: 'default',
          targetRunId: crypto.randomUUID(),
          followUp: {
            action: 'continue',
            sourceRunId: sourceRun.id,
            keptParts: numberedKeptParts,
            replacesUsage: true,
          },
        },
        trigger,
      );

      if (options?.masterAdmitted === true) {
        // Admission ran before the parts carried their own step: rewrite the
        // event the way master-era admission wrote it, so a rebuild or a
        // finalizer after the deploy reads the numbers back from the map.
        await tx
          .update(schema.runEvents)
          .set({
            payload: {
              sourceRunId: sourceRun.id,
              parts: sourceParts,
              steps: records,
            },
          })
          .where(
            and(
              eq(schema.runEvents.runId, run.id),
              eq(schema.runEvents.eventType, 'run.continued'),
            ),
          );
      }

      return {
        chatId,
        messageId,
        runId: run.id,
        seq: trigger.seq,
        keptParts:
          options?.masterAdmitted === true ? sourceParts : numberedKeptParts,
      };
    });
  }

  /** A Run of this turn that ran an attempt and completed with its answer. */
  async function completedRun(
    runsRepo: RunsRepository,
    turn: { chatId: string; messageId: string },
  ): Promise<Run | undefined> {
    const created = await runsRepo.create({
      chatId: turn.chatId,
      messageId: turn.messageId,
      userId,
      modelId: MODEL_ID,
    });

    const started = await runsRepo.markStarted(created.id, userId);

    return runsRepo.markFinished(created.id, userId, 'completed', {
      ...(started?.activeAttemptId !== null &&
        started?.activeAttemptId !== undefined && {
          attemptId: started.activeAttemptId,
        }),
    });
  }

  function userMessageOf(turn: ContinuedTurn) {
    return {
      id: turn.messageId,
      seq: turn.seq,
      parts: [{ type: 'text', text: USER_TEXT }],
    };
  }

  async function execute(
    turn: ContinuedTurn,
    client: ModelClient,
  ): Promise<void> {
    const result = await runExecution.executeRun({
      runId: turn.runId,
      chatId: turn.chatId,
      userId,
      userMessage: userMessageOf(turn),
      client,
      followUpAction: 'continue',
    });

    await (result.consumeStream?.() ?? result.text);
  }

  const runOf = (runId: string) =>
    tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(runId, userId),
    );

  const eventsOfRun = (runId: string) =>
    tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, userId),
    );

  const replyOf = (turn: ContinuedTurn): Promise<Message | undefined> =>
    tenantDb.runAs(userId, async (tx) => {
      const turnState = await new MessagesRepository(tx).findTurnState(
        turn.chatId,
        userId,
        turn.messageId,
      );

      return turnState.assistantMessage;
    });

  const contextItemsOf = (turn: ContinuedTurn) =>
    tenantDb.runAs(userId, async (tx) => {
      const turnState = await new MessagesRepository(tx).findTurnState(
        turn.chatId,
        userId,
        turn.messageId,
      );

      return (turnState.userMessage?.parts ?? []).filter(isContextItemPart);
    });

  it('sends the kept steps, executes no kept call, and finalizes kept then new parts', async () => {
    const turn = await seedContinuedTurn();
    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_ID, {
        requests,
      }),
    );

    // One request: the history through the trigger, then the kept step.
    expect(requests).toHaveLength(1);
    const sent = requests[0]?.messages ?? [];
    // The trigger appears once, and the kept step follows it directly.
    const userMessages = sent.filter(({ role }) => role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]?.content).toContainEqual({
      type: 'text',
      text: USER_TEXT,
    });
    expect(sent.at(-3)).toBe(userMessages[0]);
    // The request ends with the kept step: one assistant turn with its
    // reasoning, its text, and its call, then one turn with its result.
    expect(sent.slice(-2).map(({ role }) => role)).toEqual([
      'assistant',
      'tool',
    ]);
    expect(sent.at(-2)).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'I should read the file first' },
        { type: 'text', text: KEPT_TEXT },
        expect.objectContaining({ type: 'tool-call', toolCallId: CALL_ID }),
      ],
    });
    expect(sent.at(-1)).toMatchObject({
      role: 'tool',
      content: [
        expect.objectContaining({
          type: 'tool-result',
          toolCallId: CALL_ID,
          toolName: 'read',
        }),
      ],
    });
    // The kept result reaches the model in full, as the live loop sent it.
    expect(JSON.stringify(sent.at(-1))).toContain(KEPT_RESULT);

    // No kept call ran again: the Continue Run's log holds no tool event.
    const events = await eventsOfRun(turn.runId);
    expect(events.map(({ eventType }) => eventType)).not.toContain(
      'tool.requested',
    );

    const reply = await replyOf(turn);
    // The source reply stored its parts before step numbers existed, so
    // admission numbers the whole kept step — its reasoning and text with its
    // call — and the reply keeps it as one step (design D5).
    expect(turn.keptParts.slice(0, 3)).toEqual([
      { type: 'reasoning', text: 'I should read the file first', step: 0 },
      { type: 'text', text: KEPT_TEXT, step: 0 },
      expect.objectContaining({ toolCallId: CALL_ID, step: 0 }),
    ]);
    expect(reply?.parts).toEqual([
      ...turn.keptParts,
      { type: 'text', text: 'done', step: 1 },
    ]);
    expect(reply?.usage).toMatchObject({
      status: 'completed',
      runId: turn.runId,
      modelId: MODEL_ID,
      complete: false,
    });
    expect((await runOf(turn.runId))?.status).toBe('completed');
  });

  it('keeps the sequential steps of a reply stored before step numbers', async () => {
    // The source reply has no step on any part, and its requests recorded two
    // responses: the consecutive rule recovers them, so the calls stay in two
    // assistant messages (turn-actions D6, design D5).
    const secondCall = {
      type: 'tool-read',
      toolCallId: 'call-second',
      state: 'output-available',
      input: { path: '/tmp/second.txt' },
      output: { status: 'success', text: 'second body' },
      outcome: 'success',
    };

    const turn = await seedContinuedTurn({
      keptSteps: [0, 1],
      replyParts: [
        { type: 'text', text: 'first read' },
        keptParts[2],
        { type: 'text', text: 'second read' },
        secondCall,
      ],
    });

    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_ID, {
        requests,
      }),
    );

    const sent = requests[0]?.messages ?? [];
    expect(sent.slice(-4).map(({ role }) => role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool',
    ]);

    const callsPerMessage = sent
      .slice(-4)
      .map(({ role, content }) =>
        role === 'assistant' && Array.isArray(content)
          ? content.flatMap((part) =>
              part.type === 'tool-call' ? [part.toolCallId] : [],
            )
          : [],
      );

    expect(callsPerMessage).toEqual([[CALL_ID], [], ['call-second'], []]);
    expect(sent.at(-2)?.content).toEqual([
      { type: 'text', text: 'second read' },
      expect.objectContaining({ toolCallId: 'call-second' }),
    ]);
  });

  it('keeps the inherited steps of a master-era Continue apart', async () => {
    // The source Run continued an earlier one before parts carried a step: the
    // numbers of the two calls it inherited — two steps with no text between
    // them — live in its own `run.continued` map, and the call it made itself
    // is numbered from 0 again by its events. The Continue of it keeps both
    // inherited numbers and offsets its own call after them.
    const secondCall = {
      type: 'tool-read',
      toolCallId: 'call-second',
      state: 'output-available',
      input: { path: '/tmp/second.txt' },
      output: { status: 'success', text: 'second body' },
      outcome: 'success',
    };

    const ownCall = {
      type: 'tool-read',
      toolCallId: 'call-own',
      state: 'output-available',
      input: { path: '/tmp/own.txt' },
      output: { status: 'success', text: 'own body' },
      outcome: 'success',
    };

    const turn = await seedContinuedTurn({
      replyParts: [keptParts[2], secondCall, ownCall],
      sourceContinued: {
        parts: [keptParts[2], secondCall],
        steps: { [CALL_ID]: 0, 'call-second': 1 },
      },
    });

    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_ID, {
        requests,
      }),
    );

    expect(
      turn.keptParts.map((part) =>
        isRecord(part) && isNumber(part['step']) ? part['step'] : undefined,
      ),
    ).toEqual([0, 1, 2]);
    const sent = requests[0]?.messages ?? [];
    expect(sent.slice(-6).map(({ role }) => role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
      'tool',
    ]);

    const callsPerMessage = sent
      .slice(-6)
      .map(({ role, content }) =>
        role === 'assistant' && Array.isArray(content)
          ? content.flatMap((part) =>
              part.type === 'tool-call' ? [part.toolCallId] : [],
            )
          : [],
      );

    expect(callsPerMessage).toEqual([
      [CALL_ID],
      [],
      ['call-second'],
      [],
      ['call-own'],
      [],
    ]);

    const resultIds = sent
      .slice(-6)
      .flatMap(({ role, content }) =>
        role === 'tool' && Array.isArray(content)
          ? content.flatMap((part) =>
              part.type === 'tool-result' ? [part.toolCallId] : [],
            )
          : [],
      );

    expect(resultIds).toEqual([CALL_ID, 'call-second', 'call-own']);
  });

  it('replays the reasoning of a failed Run with its provider metadata', async () => {
    const metadata = { test: { signature: 'kept-reasoning' } };

    const turn = await seedContinuedTurn({
      replyParts: [
        { type: 'reasoning', text: 'kept thought', providerMetadata: metadata },
        keptParts[1],
        keptParts[2],
      ],
    });

    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_ID, {
        requests,
      }),
    );

    // The source Run failed, and its reasoning still reaches its own model:
    // the kept parts are the same turn, so only the model check applies
    // (design D7).
    const assistant = requests[0]?.messages.at(-2);
    expect(assistant?.content).toEqual(
      expect.arrayContaining([
        {
          type: 'reasoning',
          text: 'kept thought',
          providerOptions: metadata,
        },
      ]),
    );
  });

  it('replays a refused kept call with the SDK error text, as the live step sent it', async () => {
    const sdkErrorText = 'Invalid input for tool "read"';

    const turn = await seedContinuedTurn({
      replyParts: [
        keptParts[1],
        {
          type: 'tool-read',
          toolCallId: CALL_ID,
          state: 'output-error',
          input: { path: 7 },
          errorText: 'llame refusal message',
          outcome: 'invalid_input',
          sdkRefusal: { errorText: sdkErrorText, input: { path: 7 } },
        },
      ],
    });

    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_ID, {
        requests,
      }),
    );

    // The SDK refused the call before llame ran it, so the live step sent the
    // SDK's text; the owner-facing refusal message never reaches the model.
    const result = toolResultOf(requests[0]?.messages ?? [], CALL_ID);
    expect(result?.output).toEqual({ type: 'error-text', value: sdkErrorText });
    expect(JSON.stringify(requests[0]?.messages)).not.toContain(
      'llame refusal message',
    );
  });

  it('replays a kept input in the key order of the event log, then stores that order', async () => {
    // The source row keeps the live order `offset`, `path`; `run.continued` is
    // `jsonb`, which puts the shorter key first.
    const turn = await seedContinuedTurn({
      replyParts: [
        keptParts[1],
        {
          ...keptParts[2],
          input: { offset: 2, path: '/tmp/file.txt' },
        },
      ],
    });

    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_ID, {
        requests,
      }),
    );

    const call = requests[0]?.messages
      .flatMap((message) =>
        message.role === 'assistant' && Array.isArray(message.content)
          ? message.content
          : [],
      )
      .find(
        (part): part is ToolCallPart =>
          part.type === 'tool-call' && part.toolCallId === CALL_ID,
      );

    const jsonbOrder = '{"path":"/tmp/file.txt","offset":2}';
    expect(JSON.stringify(call?.input)).toBe(jsonbOrder);
    const reply = await replyOf(turn);

    const stored = (reply?.parts ?? []).find(
      (part) => isRecord(part) && part['toolCallId'] === CALL_ID,
    );

    expect(JSON.stringify(isRecord(stored) ? stored['input'] : null)).toBe(
      jsonbOrder,
    );
  });

  it('numbers its own parts after a kept step', async () => {
    const turn = await seedContinuedTurn({ replyParts: keptPartsAtStepOne });

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_ID),
    );

    // The kept call ended at step 1, so the answer is step 2 even though this
    // request makes no tool step to stamp one (design D5).
    const reply = await replyOf(turn);
    expect(reply?.parts).toEqual([
      ...turn.keptParts,
      { type: 'text', text: 'done', step: 2 },
    ]);
  });

  it('keeps the kept parts when it fails after a new part', async () => {
    const turn = await seedContinuedTurn();

    await execute(
      turn,
      scriptedClient(scriptedModel(failureChunks('partial')), MODEL_ID),
    );

    const reply = await replyOf(turn);
    expect(reply?.parts).toEqual([
      ...turn.keptParts,
      { type: 'text', text: 'partial', step: 1 },
    ]);
    expect(reply?.usage).toMatchObject({ status: 'error', runId: turn.runId });
    expect((await runOf(turn.runId))?.status).toBe('failed');
  });

  it('fails before dispatch when the kept parts do not fit, and changes nothing', async () => {
    const turn = await seedContinuedTurn();
    const before = await replyOf(turn);
    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    // A window the trigger plus the kept parts cannot fit after compaction
    // leaves nothing to summarize, so preparation fails the Run.
    await expect(
      execute(
        turn,
        scriptedClient(scriptedModel(answerChunks('done')), MODEL_ID, {
          requests,
          contextWindowTokens: 8,
        }),
      ),
    ).rejects.toThrow(/context window/u);

    expect(requests).toHaveLength(0);
    const events = await eventsOfRun(turn.runId);
    expect(events.map(({ eventType }) => eventType)).toEqual([
      'run.created',
      'run.continued',
      'run.started',
      'run.failed',
    ]);
    const reply = await replyOf(turn);
    expect(reply?.parts).toEqual(before?.parts);
    expect(reply?.usage).toEqual(before?.usage);
  });

  it('keeps one temporal item, appends an availability change, and adds no model-switch item', async () => {
    const turn = await seedContinuedTurn({
      // The earlier Run of this turn recorded `read` as available; the
      // preceding turn recorded nothing available, so a baseline that read
      // that turn would find no change at all.
      sourceAvailability: [{ id: 'read', state: 'available' }],
      temporalItem: true,
      previousReplyModelId: OTHER_MODEL_ID,
    });

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_ID),
    );

    const items = await contextItemsOf(turn);
    expect(
      items.filter((item) => item.data.producer === 'temporal'),
    ).toHaveLength(1);
    expect(
      items.filter((item) => item.data.producer === 'model-switch'),
    ).toHaveLength(0);

    // The availability comparison runs against the earlier Run of this turn,
    // whose record named `read`, so its removal is appended after the items the
    // turn already stored.
    const availability = items.filter(
      (item) => item.data.producer === 'tool-availability',
    );

    expect(availability).toHaveLength(1);
    expect(items.at(-1)).toBe(availability[0]);
    expect(availability[0]?.data.runId).toBe(turn.runId);
  });

  it('reuses the stored skill activation and stores no second one', async () => {
    // The turn named a skill an earlier Run already activated; the Continue
    // Run carries that item and authors no second one (turn-actions D8).
    const turn = await seedContinuedTurn({ skillActivationItem: 'demo' });

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_ID),
    );

    const items = await contextItemsOf(turn);
    expect(
      items.filter((item) => item.data.producer === 'skill-activation'),
    ).toHaveLength(1);
    expect(
      (await eventsOfRun(turn.runId)).filter(
        ({ eventType }) => eventType === 'tool.requested',
      ),
    ).toEqual([]);
  });

  it("keeps a chained Continue's earlier steps separate from its own", async () => {
    // The source Run was itself continued: its kept parts already record step
    // 0, and the step it made itself is numbered from 0 again by its events.
    // The new Continue must send both as separate steps, and the kept part
    // carries the result the source Run sent.
    const turn = await seedContinuedTurn({
      chainedOwnCall: true,
      replyParts: [
        { ...keptParts[0], step: 0 },
        { ...keptParts[1], step: 0 },
        { ...keptParts[2], step: 0 },
        {
          type: 'tool-read',
          toolCallId: 'call-own',
          state: 'output-available',
          input: { path: '/tmp/second.txt' },
          output: { status: 'success', text: 'second file' },
          outcome: 'success',
        },
      ],
    });

    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_ID, {
        requests,
      }),
    );

    const sent = requests[0]?.messages ?? [];
    expect(sent.slice(-4).map(({ role }) => role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool',
    ]);

    // Both kept calls arrive, each in its own assistant turn.
    const callIds = sent.flatMap(({ role, content }) =>
      role === 'assistant' && Array.isArray(content)
        ? content.flatMap((part) =>
            part.type === 'tool-call' ? [part.toolCallId] : [],
          )
        : [],
    );

    expect(callIds).toEqual([CALL_ID, 'call-own']);
    // The inherited call replays the result its kept part stores, exactly as
    // the live loop sent it rather than through the later-turn renderer.
    const inheritedResult = toolResultOf(sent, CALL_ID);
    expect(inheritedResult).toMatchObject({
      type: 'tool-result',
      toolName: 'read',
      output: { type: 'text' },
    });
    // The live loop sent a native result as its serialized form, with no
    // untrusted frame and no budget.
    const serialized = inheritedResult?.output;
    expect(
      serialized?.type === 'text' ? JSON.parse(serialized.value) : undefined,
    ).toEqual({
      status: 'success',
      path: '/tmp/file.txt',
      text: KEPT_RESULT,
    });
  });

  it('reads the previous completed Run the reply names, not the newest one', async () => {
    // Two completed Runs answer one turn; the reply names the older, which is
    // the Run whose answer and receipts a later summary must reproduce.
    const chatId = crypto.randomUUID();

    const seeded = await tenantDb.runAs(userId, async (tx) => {
      const messagesRepo = new MessagesRepository(tx);
      const runsRepo = new RunsRepository(tx);
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: userId,
        title: 'Previous completed Run',
      });

      const trigger = await messagesRepo.create({
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: USER_TEXT }],
      });

      // A completed Run records the attempt that produced its answer, which is
      // the link the previous-completed-Run lookup requires.
      const older = await completedRun(runsRepo, {
        chatId,
        messageId: trigger.id,
      });

      await messagesRepo.createAssistantReplyIfAbsent({
        chatId,
        inReplyTo: trigger.id,
        parts: [{ type: 'text', text: 'the older answer' }],
        usage: { status: 'completed', complete: true, runId: older!.id },
      });
      await completedRun(runsRepo, { chatId, messageId: trigger.id });

      return { seq: trigger.seq, olderId: older!.id };
    });

    // Nothing precedes the trigger, so no reply is answerable yet.
    await expect(
      tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findCompletedReplyRunBefore(chatId, userId, {
          beforeSeq: seeded.seq,
        }),
      ),
    ).resolves.toBeUndefined();
    // The newest completed Run answers this turn too, so only the reply's
    // usage can name the one that produced the answer the model read.
    await expect(
      tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findCompletedReplyRunBefore(chatId, userId, {
          // Any sequence after this turn's reply stands for a later turn.
          beforeSeq: seeded.seq + 10,
        }),
      ),
    ).resolves.toMatchObject({ run: { id: seeded.olderId } });
  });

  it('reuses the stored prompt-imports item and stores no second one', async () => {
    const turn = await seedContinuedTurn({ promptImportsItem: true });

    await execute(
      turn,
      scriptedClient(scriptedModel(answerChunks('done')), MODEL_ID),
    );

    const items = await contextItemsOf(turn);
    expect(
      items.filter((item) => item.data.producer === 'prompt-imports'),
    ).toHaveLength(1);
  });

  it('finalizes kept parts and its own in-Run item once when the worker dies', async () => {
    const keptItem = {
      type: 'data-context',
      data: {
        v: 1,
        producer: 'instructions',
        runId: crypto.randomUUID(),
        payload: {},
        text: '<system-reminder producer="instructions">kept item</system-reminder>',
      },
    };

    // The kept boundary carries the item an earlier Run authored, so the
    // rebuild must not place a second copy of it.
    const turn = await seedContinuedTurn({
      replyParts: [...keptParts, keptItem],
    });

    const ownItem = {
      type: 'data-context',
      data: {
        v: 1,
        producer: 'instructions',
        runId: turn.runId,
        payload: {},
        text: '<system-reminder producer="instructions">own item</system-reminder>',
      },
    };

    // Attempt A dispatched and stored a part snapshot holding its own in-Run
    // item, then died without settling.
    await tenantDb.runAs(userId, async (tx) => {
      const runsRepo = new RunsRepository(tx);
      const started = await runsRepo.markStarted(turn.runId, userId);
      const attemptId = started?.activeAttemptId;

      if (!attemptId) throw new Error('Attempt A did not claim the Run.');
      const events = new RunEventsRepository(tx);
      await events.append(turn.runId, 'run.started');
      await events.append(turn.runId, 'model.requested', {
        modelId: MODEL_ID,
        attemptId,
      });
      await events.append(turn.runId, 'model.delta', { text: 'half' });
      await new RunningReplyRepository(tx).upsertRunningReply({
        chatId: turn.chatId,
        inReplyTo: turn.messageId,
        usage: {
          status: 'running',
          complete: false,
          runId: turn.runId,
          attemptId,
          modelId: MODEL_ID,
        },
        followUpAction: 'continue',
      });
      await new RunningReplyRepository(tx).updateRunningReplyParts({
        chatId: turn.chatId,
        inReplyTo: turn.messageId,
        attemptId,
        parts: [...turn.keptParts, ownItem],
      });
    });

    await runExecution.settleTerminalRun({
      userId,
      runId: turn.runId,
      status: 'failed',
      runPayload: { status: 'failed' },
      error: { message: 'the worker died' },
    });

    const reply = await replyOf(turn);
    // The kept parts come first, once (the kept item they carried included),
    // then the attempt's own item — no rebuilt part holds a kept call id, so it
    // goes at the start of the rebuilt reply — then the attempt's output.
    expect(reply?.parts).toEqual([
      ...turn.keptParts,
      ownItem,
      { type: 'text', text: 'half' },
    ]);
  });

  it('numbers a rebuilt part after the kept steps when the worker dies', async () => {
    const turn = await seedContinuedTurn({ replyParts: keptPartsAtStepOne });
    // Attempt A dispatched, streamed one part, and died without a collector to
    // settle it: the settler rebuilds the reply from the Run's own events.
    await tenantDb.runAs(userId, async (tx) => {
      const started = await new RunsRepository(tx).markStarted(
        turn.runId,
        userId,
      );

      const attemptId = started?.activeAttemptId;

      if (!attemptId) throw new Error('Attempt A did not claim the Run.');
      const events = new RunEventsRepository(tx);
      await events.append(turn.runId, 'run.started');
      await events.append(turn.runId, 'model.requested', {
        modelId: MODEL_ID,
        attemptId,
      });
      await events.append(turn.runId, 'model.delta', {
        text: 'half',
        stepNumber: 0,
      });
      await new RunningReplyRepository(tx).upsertRunningReply({
        chatId: turn.chatId,
        inReplyTo: turn.messageId,
        usage: {
          status: 'running',
          complete: false,
          runId: turn.runId,
          attemptId,
          modelId: MODEL_ID,
        },
        followUpAction: 'continue',
      });
    });

    await runExecution.settleTerminalRun({
      userId,
      runId: turn.runId,
      status: 'failed',
      runPayload: { status: 'failed' },
      error: { message: 'the worker died' },
    });

    // The rebuild shifts the SDK's step 0 by the kept steps, exactly as the
    // live collector would have (design D5).
    const reply = await replyOf(turn);
    expect(reply?.parts).toEqual([
      ...turn.keptParts,
      { type: 'text', text: 'half', step: 2 },
    ]);
  });

  it('keeps a master-era Continue grouping and offset when it rebuilds', async () => {
    // The Run was admitted before the parts carried their own step: its event
    // holds the unnumbered parts and their numbers in the retired `steps` map.
    // A settler after the deploy must send the two back-to-back kept steps
    // separately and put its own part after the second.
    const secondCall = {
      type: 'tool-read',
      toolCallId: 'call-second',
      state: 'output-available',
      input: { path: '/tmp/second.txt' },
      output: { status: 'success', text: 'second body' },
      outcome: 'success',
    };

    const turn = await seedContinuedTurn({
      masterAdmitted: true,
      keptSteps: [0, 1],
      replyParts: [keptParts[2], secondCall],
    });

    await tenantDb.runAs(userId, async (tx) => {
      const started = await new RunsRepository(tx).markStarted(
        turn.runId,
        userId,
      );

      const attemptId = started?.activeAttemptId;

      if (!attemptId) throw new Error('Attempt A did not claim the Run.');
      const events = new RunEventsRepository(tx);
      await events.append(turn.runId, 'run.started');
      await events.append(turn.runId, 'model.requested', {
        modelId: MODEL_ID,
        attemptId,
      });
      await events.append(turn.runId, 'model.delta', {
        text: 'half',
        stepNumber: 0,
      });
      await new RunningReplyRepository(tx).upsertRunningReply({
        chatId: turn.chatId,
        inReplyTo: turn.messageId,
        usage: {
          status: 'running',
          complete: false,
          runId: turn.runId,
          attemptId,
          modelId: MODEL_ID,
        },
        followUpAction: 'continue',
      });
    });

    await runExecution.settleTerminalRun({
      userId,
      runId: turn.runId,
      status: 'failed',
      runPayload: { status: 'failed' },
      error: { message: 'the worker died' },
    });

    // The rebuild reads both the chain's numbers and its offset back from the
    // event, so it does not merge the two kept steps.
    const reply = await replyOf(turn);
    expect(reply?.parts).toEqual([
      { ...keptParts[2], step: 0 },
      { ...secondCall, step: 1 },
      { type: 'text', text: 'half', step: 2 },
    ]);
  });
});

/** The tool-result part for `toolCallId` in the request the Run sent. */
function toolResultOf(
  messages: Array<ModelMessage>,
  toolCallId: string,
): ToolResultPart | undefined {
  return messages.flatMap((message) =>
    message.role === 'tool' && Array.isArray(message.content)
      ? message.content.filter(
          (part): part is ToolResultPart =>
            part.type === 'tool-result' && part.toolCallId === toolCallId,
        )
      : [],
  )[0];
}

/** The recorded result of one kept part, when it is a settled `read` call. */
function keptResultOf(part: unknown):
  | {
      toolCallId: string;
      input: unknown;
      output: { status: 'success' } & UnknownRecord;
    }
  | undefined {
  if (!isRecord(part)) return undefined;
  const toolCallId = part['toolCallId'];
  const output = part['output'];

  return isString(toolCallId) &&
    isRecord(output) &&
    output['status'] === 'success'
    ? {
        toolCallId,
        input: part['input'],
        output: { ...output, status: 'success' },
      }
    : undefined;
}
