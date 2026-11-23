/**
 * Continue on the next candidate of a failed turn Run (model-roles D4/D5/D7,
 * tasks 6.1/6.3) — a REAL Postgres, a REAL `ModelsService` over a
 * role-holding config, and the real `FollowUpAdmissionService`. The new Run is
 * then executed by `RunExecutionService` over a scripted client, so the first
 * request of the new model is observable as history.
 *
 * Covers the `model-roles` scenarios "Continue on the next candidate", "A Run
 * with an exact selector", "The last candidate fails", "An exact model is
 * unavailable", "A usage limit sets the hold to the reset", "An auth failure
 * sets a short hold", "The owner picked another selector", "The owner picked
 * the same role during the Run", and `turn-actions` "Continue on the next
 * candidate of a cancelled Run is refused", "The failed reply keeps its usage
 * after a switch", "Continue on the next candidate sends the failed reply as
 * history", "Continue after a switch keeps the effort of the last segment",
 * plus `model-system-prompts` "A role moves to its next candidate".
 *
 * TEST_DATABASE_URL-gated; run by test:integration with the other
 * `.integration` suites.
 */

import type { ModelMessage, ToolCallPart, ToolResultPart } from 'ai';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { isRecord } from '@workspace/runtime-safety';

import { type Message } from '../db/schema';
import { type ContextItemPart, isContextItemPart } from './context-item';
import { TenantDbService } from '../db/tenant-db.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import { type ChatModelSelection } from '../models/model-selection';
import type { InstanceConfigReader } from '../instance-config/instance-config.service';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import { type ModelClient } from '../models/model-client';
import { type FailureClass } from '../models/provider-failure/provider-failure';
import { ModelsService } from '../models/models.service';
import { type RunDispatcher } from '../runs/run-dispatch.service';
import { RunExecutionService } from '../runs/run-execution.service';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import {
  answerChunks,
  makeRunExecutionService,
  scriptedClient,
  scriptedModel,
} from '../testing/run-execution-integration-fixture';
import { type AcceptedRun } from './chat-loop.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import {
  FollowUpAdmissionService,
  type FollowUpRequestInput,
} from './follow-up-admission.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

const CODEX_ID = 'system:openai:codex';
const SONNET_ID = 'system:anthropic:sonnet';
const FAST_ID = 'system:openai:fast';

function catalogEntry(
  id: string,
  provider: string,
  effortLevels?: ReadonlyArray<{ value: string }>,
  defaultEffort?: string,
): SystemModelCatalogEntry {
  return {
    id,
    source: 'system',
    contextWindowTokens: 128_000,
    input: ['text'],
    provider,
    providerModelId: id,
    systemPromptTemplate: `Prompt for ${id}`,
    systemPromptSource: 'model_override',
    referencesSkills: false,
    billing: 'subscription',
    ...(effortLevels !== undefined &&
      defaultEffort !== undefined && {
        reasoning: {
          effortLevels,
          defaultEffort,
          cacheInvalidatedByEffortChange: false,
        },
      }),
  };
}

/** The primary declares `xhigh`; the fallback declares `medium`/`low`. */
const CODEX = catalogEntry(
  CODEX_ID,
  'openai',
  [{ value: 'xhigh' }, { value: 'high' }, { value: 'low' }],
  'high',
);

const SONNET = catalogEntry(
  SONNET_ID,
  'anthropic',
  [{ value: 'medium' }, { value: 'low' }],
  'low',
);

const FAST = catalogEntry(FAST_ID, 'openai');

const CONFIG: LlameConfig = {
  ...BUILT_IN_DEFAULTS,
  defaults: { selector: '@coding', titleGenerationSelector: null },
  providers: [
    {
      id: 'openai',
      type: 'openai-completions',
      key: null,
      baseUrl: 'https://next-candidate.example.test/v1',
      headers: {},
    },
    {
      id: 'anthropic',
      type: 'anthropic',
      key: null,
      baseUrl: 'https://next-candidate.example.test/v1',
      headers: {},
    },
  ],
  models: [CODEX, SONNET, FAST],
  modelRoles: [
    {
      name: 'coding',
      candidates: [
        { modelId: CODEX_ID, effort: 'high' },
        { modelId: SONNET_ID, effort: 'low' },
      ],
    },
    { name: 'fast', candidates: [{ modelId: FAST_ID }] },
  ],
  tools: {
    ...BUILT_IN_DEFAULTS.tools,
    permissionModes: ['default', 'bypass'],
  },
};

const PROVIDER_FAILURE_LABEL = 'provider overload';

/** The settled `read` call the failed reply already ran. */
const READ_CALL = {
  type: 'tool-read',
  toolCallId: 'call-read',
  state: 'output-available',
  input: { path: '/tmp/one.txt' },
  output: { status: 'success', text: 'one' },
  outcome: 'success',
};

/** The settled `edit` call the new model must receive, never re-run. */
const EDIT_CALL = {
  type: 'tool-edit',
  toolCallId: 'call-edit',
  state: 'output-available',
  input: { path: '/tmp/two.txt', old: 'a', new: 'b' },
  output: { status: 'success', replacements: 1 },
  outcome: 'success',
};

/** The reply of a failed role turn: reasoning, text, then two settled calls. */
const FAILED_REPLY_PARTS: Array<unknown> = [
  { type: 'reasoning', text: 'the codex thought' },
  { type: 'text', text: 'working' },
  READ_CALL,
  EDIT_CALL,
  { type: 'text', text: 'unfinished' },
];

type SourceTurn = {
  chatId: string;
  messageId: string;
  replyId: string;
  runId: string;
};

describeIfDb('Continue on the next candidate', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  let models: ModelsService;
  let admission: FollowUpAdmissionService;
  let runExecution: RunExecutionService;
  let userId: string;

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL!, {
      max: 4,
      ssl: /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false,
    });
    tenantDb = new TenantDbService(drizzle({ client: sql }));
    userId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Next candidate', ${`next-candidate-${userId}@test.com`})`;

    const instanceConfig: InstanceConfigReader & {
      productUserAgent: string;
    } = { config: CONFIG, productUserAgent: 'llame/next-candidate-test' };

    models = new ModelsService(instanceConfig);

    const dispatch: RunDispatcher = {
      dispatch: vi.fn(async () => {}),
      jobState: vi.fn<RunDispatcher['jobState']>(() =>
        Promise.resolve('absent'),
      ),
    };

    admission = new FollowUpAdmissionService(
      tenantDb,
      models,
      instanceConfig,
      dispatch,
    );

    runExecution = makeRunExecutionService({
      tenantDb,
      instanceConfig,
      models,
    });
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });

  /** One failed turn: Chat, selection, user message, Run, and optional reply. */
  async function seedFailedTurn(
    options: {
      selector?: string;
      modelId?: string;
      selectedEffort?: string | null;
      effort?: string | null;
      status?: 'failed' | 'cancelled' | 'expired';
      error?: { code: FailureClass; resetsAt?: number; hintMs?: number } | null;
      replyParts?: Array<unknown>;
      noReply?: boolean;
      selection?: ChatModelSelection | null;
      selectionRevision?: number | null;
    } = {},
  ): Promise<SourceTurn> {
    const selector = options.selector ?? '@coding';
    const modelId = options.modelId ?? CODEX_ID;

    const error =
      options.error === null
        ? null
        : {
            message: 'the provider failed',
            ...(options.error ?? { code: 'overloaded' }),
          };

    return tenantDb.runAs(userId, async (tx) => {
      const chat = await new ChatsRepository(tx).create({
        ownerUserId: userId,
        title: 'Next candidate',
      });

      await new ChatsRepository(tx).setModelSelection(
        chat.id,
        userId,
        options.selection ?? {
          revision: 1,
          selector,
          effort: 'xhigh',
        },
      );

      const messages = new MessagesRepository(tx);

      const userMessage = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: 'Do the work' }],
      });

      const runs = new RunsRepository(tx);

      const created = await runs.create({
        chatId: chat.id,
        messageId: userMessage.id,
        userId,
        modelId,
        selector,
        effort: options.effort ?? 'high',
        selectedEffort: options.selectedEffort ?? 'xhigh',
        selectionRevision:
          options.selectionRevision === null
            ? undefined
            : (options.selectionRevision ?? 1),
      });

      await runs.markFinished(created.id, userId, options.status ?? 'failed', {
        ...(error !== null && { error }),
      });

      const reply = options.noReply
        ? undefined
        : await messages.createAssistantReplyIfAbsent({
            chatId: chat.id,
            inReplyTo: userMessage.id,
            parts: options.replyParts ?? FAILED_REPLY_PARTS,
            usage: {
              status: 'error',
              complete: false,
              runId: created.id,
              modelId,
              attemptId: crypto.randomUUID(),
            },
          });

      if (!options.noReply && !reply) {
        throw new Error('The failed reply was not stored.');
      }

      return {
        chatId: chat.id,
        messageId: userMessage.id,
        replyId: reply?.id ?? '',
        runId: created.id,
      };
    });
  }

  function admit(turn: SourceTurn, request: FollowUpRequestInput) {
    return admission.admitFollowUpRun({
      chatId: turn.chatId,
      userId,
      userMessageId: turn.messageId,
      request,
    });
  }

  const nextCandidateRequest: FollowUpRequestInput = {
    action: 'continue',
    candidate: 'next',
  };

  const runsOf = (chatId: string) =>
    tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findByChatId(chatId, userId),
    );

  const eventsOf = (runId: string) =>
    tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, userId),
    );

  const messageOf = (chatId: string, messageId: string) =>
    tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findById(chatId, userId, messageId),
    );

  const chatOf = (chatId: string) =>
    tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).findById(chatId, userId),
    );

  /** The switch item of a stored message. */
  function switchItemOf(message: Message): ContextItemPart | undefined {
    return message.parts
      .filter(isContextItemPart)
      .find((part) => part.data.producer === 'effective-context-change');
  }

  function toolCalls(sent: ReadonlyArray<ModelMessage>): Array<ToolCallPart> {
    return sent.flatMap((message) =>
      message.role === 'assistant' && Array.isArray(message.content)
        ? message.content.flatMap((part) =>
            part.type === 'tool-call' ? [part] : [],
          )
        : [],
    );
  }

  function toolResults(
    sent: ReadonlyArray<ModelMessage>,
  ): Array<ToolResultPart> {
    return sent.flatMap((message) =>
      message.role === 'tool' && Array.isArray(message.content)
        ? message.content.flatMap((part) =>
            part.type === 'tool-result' ? [part] : [],
          )
        : [],
    );
  }

  /** The text of the request's last (host) user message. */
  function hostText(sent: ReadonlyArray<ModelMessage>): string {
    const host = sent.at(-1);

    if (host?.role !== 'user') return '';

    return JSON.stringify(host.content);
  }

  /** Execute the admitted host Run and answer its first request. */
  async function execute(
    admitted: AcceptedRun,
    requests: Array<Parameters<ModelClient['streamText']>[0]> = [],
  ): Promise<void> {
    const client = scriptedClient(
      scriptedModel(answerChunks('done')),
      SONNET_ID,
      {
        requests,
      },
    );

    const result = await runExecution.executeRun({
      runId: admitted.runId,
      chatId: admitted.chatId,
      userId,
      userMessage: admitted.userMessage,
      client,
      followUpAction: 'continue',
    });

    await (result.consumeStream?.() ?? result.text);
  }

  it('Continue on the next candidate', async () => {
    const turn = await seedFailedTurn();
    const admitted = await admit(turn, nextCandidateRequest);
    const runs = await runsOf(turn.chatId);
    const run = runs.find((candidate) => candidate.id === admitted.runId);

    // The Run continues the role on its second candidate, at D5's effort, and
    // records the source's selected effort and the source Run.
    expect(run).toMatchObject({
      chatId: turn.chatId,
      messageId: admitted.userMessage.id,
      selector: '@coding',
      modelId: SONNET_ID,
      effort: 'low',
      selectedEffort: 'xhigh',
      followUpAction: 'continue',
      sourceRunId: turn.runId,
      status: 'queued',
    });
    expect(run?.messageId).not.toBe(turn.messageId);

    // The Chat holds the next candidate for the role.
    const selection = (await chatOf(turn.chatId))?.modelSelection;
    expect(selection).toMatchObject({
      revision: 1,
      selector: '@coding',
      effort: 'xhigh',
      hold: { selector: '@coding', modelId: SONNET_ID, effort: 'low' },
    });

    // The host message carries the `failover` item and no owner text.
    const host = await messageOf(turn.chatId, admitted.userMessage.id);
    const item = host === undefined ? undefined : switchItemOf(host);
    expect(item?.data).toMatchObject({
      producer: 'effective-context-change',
      form: 'notice',
      runId: turn.runId,
    });
    expect(item?.data.payload).toMatchObject({
      cause: 'failover',
      fromModelId: CODEX_ID,
      toModelId: SONNET_ID,
      failureClass: 'overloaded',
    });
    expect(host?.senderUserId).toBeNull();

    // The source reply keeps its usage, its model, and the Run it names.
    const source = await messageOf(turn.chatId, turn.replyId);
    expect(source?.usage).toMatchObject({
      status: 'error',
      runId: turn.runId,
      modelId: CODEX_ID,
    });

    // The Run log names the switch after its creation, and continues nothing.
    const events = await eventsOf(admitted.runId);
    expect(events.map((event) => event.eventType)).toEqual([
      'run.created',
      'model.switched',
    ]);
    expect(events[0]?.payload).toEqual({
      chatId: turn.chatId,
      messageId: admitted.userMessage.id,
    });
    expect(events[1]?.payload).toEqual({
      fromModelId: CODEX_ID,
      fromEffort: 'high',
      toModelId: SONNET_ID,
      toEffort: 'low',
      failureClass: 'overloaded',
      messageId: admitted.userMessage.id,
      origin: 'owner',
    });

    // The first request to the new model carries the two settled calls with
    // their results, then the host message. No reasoning of the old model.
    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];
    await execute(admitted, requests);
    expect(requests[0]?.effort).toBe('low');

    const sent = requests[0]?.messages ?? [];
    expect(toolCalls(sent).map((call) => call.toolCallId)).toEqual([
      'call-read',
      'call-edit',
    ]);
    expect(toolResults(sent).map((result) => result.toolCallId)).toEqual([
      'call-read',
      'call-edit',
    ]);
    expect(JSON.stringify(sent)).not.toContain('the codex thought');
    expect(JSON.stringify(sent)).not.toContain('unfinished');

    // The new reply records the new model's usage; the source keeps its own.
    const reply = await messageOf(turn.chatId, admitted.userMessage.id).then(
      () =>
        tenantDb.runAs(userId, async (tx) => {
          const state = await new MessagesRepository(tx).findTurnState(
            turn.chatId,
            userId,
            admitted.userMessage.id,
          );

          return state.assistantMessage;
        }),
    );

    expect(reply?.usage).toMatchObject({ modelId: SONNET_ID });

    const sourceAfter = await messageOf(turn.chatId, turn.replyId);
    expect(sourceAfter?.usage).toEqual(source?.usage);
  });

  it('continues a failed role Run that stored no reply', async () => {
    const turn = await seedFailedTurn({ noReply: true });
    const admitted = await admit(turn, nextCandidateRequest);

    const run = (await runsOf(turn.chatId)).find(
      (candidate) => candidate.id === admitted.runId,
    );

    expect(run).toMatchObject({ modelId: SONNET_ID, status: 'queued' });

    const host = await messageOf(turn.chatId, admitted.userMessage.id);
    expect(host).toBeDefined();
    expect(switchItemOf(host!)?.data.payload).toMatchObject({
      cause: 'failover',
      toModelId: SONNET_ID,
    });
    expect(
      (await eventsOf(admitted.runId)).map((event) => event.eventType),
    ).toEqual(['run.created', 'model.switched']);

    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];
    await execute(admitted, requests);
    expect(requests[0]?.system).toContain(`Prompt for ${SONNET_ID}`);
  });
  it('A role moves to its next candidate', async () => {
    const turn = await seedFailedTurn({ selectedEffort: 'medium' });
    const admitted = await admit(turn, nextCandidateRequest);
    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(admitted, requests);
    expect(requests[0]?.effort).toBe('medium');

    // The new model receives its own system prompt and tool declarations, and
    // the switch item comes directly before its first request's host message.
    expect(requests[0]?.system).toContain(`Prompt for ${SONNET_ID}`);
    expect(requests[0]?.system).not.toContain(`Prompt for ${CODEX_ID}`);
    expect(toolCalls(requests[0]?.messages ?? [])).not.toHaveLength(0);

    const host = hostText(requests[0]?.messages ?? []);
    expect(host).toContain('The active model changed during this Run');
    expect(host).toContain(PROVIDER_FAILURE_LABEL);
    expect(host).toContain(`You are now ${SONNET_ID}`);
  });

  it('Continue on the next candidate sends the failed reply as history', async () => {
    const turn = await seedFailedTurn({
      replyParts: [
        { type: 'reasoning', text: 'the codex thought' },
        EDIT_CALL,
        { type: 'text', text: 'unfinished' },
      ],
    });

    const admitted = await admit(turn, nextCandidateRequest);
    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];

    await execute(admitted, requests);

    const sent = requests[0]?.messages ?? [];

    const call = toolCalls(sent).find(
      (part) => part.toolCallId === 'call-edit',
    );

    const result = toolResults(sent).find(
      (part) => part.toolCallId === 'call-edit',
    );

    expect(call).toBeDefined();
    // The model receives the stored observation of the call, never a new run.
    expect(JSON.stringify(result?.output)).toContain('edited');
    expect(JSON.stringify(sent)).not.toContain('the codex thought');

    // `edit` did not run again: the reply of the new Run holds only its answer.
    const reply = await tenantDb.runAs(userId, async (tx) => {
      const state = await new MessagesRepository(tx).findTurnState(
        turn.chatId,
        userId,
        admitted.userMessage.id,
      );

      return state.assistantMessage;
    });

    expect(reply?.parts).toEqual([{ type: 'text', text: 'done', step: 0 }]);
    expect(
      (reply?.parts ?? []).filter(
        (part) => isRecord(part) && 'toolCallId' in part,
      ),
    ).toHaveLength(0);
  });

  it('The failed reply keeps its usage after a switch', async () => {
    const turn = await seedFailedTurn();
    const before = await messageOf(turn.chatId, turn.replyId);
    const admitted = await admit(turn, nextCandidateRequest);

    await execute(admitted);

    // The cut keeps the settled parts; the usage and the model stay untouched.
    const after = await messageOf(turn.chatId, turn.replyId);
    expect(after?.usage).toEqual(before?.usage);
    expect(after?.parts).toEqual(
      FAILED_REPLY_PARTS.slice(0, FAILED_REPLY_PARTS.length - 1),
    );
  });

  it('Continue after a switch keeps the effort of the last segment', async () => {
    const turn = await seedFailedTurn();
    const switched = await admit(turn, nextCandidateRequest);

    await tenantDb.runAs(userId, async (tx) => {
      await new RunsRepository(tx).markFinished(
        switched.runId,
        userId,
        'failed',
        {
          error: { message: 'the fallback failed', code: 'overloaded' },
        },
      );
      await new MessagesRepository(tx).createAssistantReplyIfAbsent({
        chatId: turn.chatId,
        inReplyTo: switched.userMessage.id,
        parts: [READ_CALL],
        usage: {
          status: 'error',
          complete: false,
          runId: switched.runId,
          modelId: SONNET_ID,
          attemptId: crypto.randomUUID(),
        },
      });
    });

    const continued = await admission.admitFollowUpRun({
      chatId: turn.chatId,
      userId,
      userMessageId: switched.userMessage.id,
      request: { action: 'continue' },
    });

    const run = (await runsOf(turn.chatId)).find(
      (candidate) => candidate.id === continued.runId,
    );

    expect(run).toMatchObject({
      messageId: switched.userMessage.id,
      modelId: SONNET_ID,
      effort: 'low',
      selectedEffort: 'xhigh',
      followUpAction: 'continue',
    });

    const requests: Array<Parameters<ModelClient['streamText']>[0]> = [];
    await execute(continued, requests);
    expect(requests[0]?.effort).toBe('low');
  });

  it('A Run with an exact selector', async () => {
    const turn = await seedFailedTurn({ selector: CODEX_ID });
    const before = await runsOf(turn.chatId);

    await expect(admit(turn, nextCandidateRequest)).rejects.toMatchObject({
      status: 409,
      response: { code: 'next_candidate_unavailable' },
    });

    expect(await runsOf(turn.chatId)).toHaveLength(before.length);
  });

  it('An exact model is unavailable', async () => {
    const turn = await seedFailedTurn({
      selector: CODEX_ID,
      error: { code: 'overloaded' },
    });

    await expect(admit(turn, nextCandidateRequest)).rejects.toMatchObject({
      status: 409,
      response: { code: 'next_candidate_unavailable' },
    });

    // No other model receives a request: the Run stays failed with its cause.
    const runs = await runsOf(turn.chatId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: turn.runId,
      status: 'failed',
      selector: CODEX_ID,
    });
    expect(models.nextCandidate(CODEX_ID, CODEX_ID)).toBeUndefined();
  });

  it('The last candidate fails', async () => {
    const turn = await seedFailedTurn({ modelId: SONNET_ID });

    await expect(admit(turn, nextCandidateRequest)).rejects.toMatchObject({
      status: 409,
      response: { code: 'next_candidate_unavailable' },
    });
    expect(await runsOf(turn.chatId)).toHaveLength(1);
  });

  it('Continue on the next candidate of a cancelled Run is refused', async () => {
    const turn = await seedFailedTurn({ status: 'cancelled' });

    await expect(admit(turn, nextCandidateRequest)).rejects.toMatchObject({
      status: 409,
      response: { code: 'next_candidate_unavailable' },
    });
    expect(await runsOf(turn.chatId)).toHaveLength(1);
  });

  it('A usage limit sets the hold to the reset', async () => {
    const resetsAt = Date.now() + 3_600_000;

    const turn = await seedFailedTurn({
      error: { code: 'quota_exhausted', resetsAt },
    });

    await admit(turn, nextCandidateRequest);

    const selection = (await chatOf(turn.chatId))?.modelSelection;
    expect(selection?.hold?.revertAt).toBe(new Date(resetsAt).toISOString());
  });

  it('An auth failure sets a short hold', async () => {
    const turn = await seedFailedTurn({ error: { code: 'auth' } });
    const before = Date.now();

    await admit(turn, nextCandidateRequest);

    const revertAt = Date.parse(
      (await chatOf(turn.chatId))?.modelSelection?.hold?.revertAt ?? '',
    );

    expect(revertAt - before).toBeGreaterThanOrEqual(5 * 60_000 - 5000);
    expect(revertAt - before).toBeLessThanOrEqual(5 * 60_000 + 15_000);
  });

  it('A retry hint sets the hold when the failure named no reset', async () => {
    const turn = await seedFailedTurn({
      error: { code: 'rate_limited', hintMs: 90_000 },
    });

    const before = Date.now();

    await admit(turn, nextCandidateRequest);

    const revertAt = Date.parse(
      (await chatOf(turn.chatId))?.modelSelection?.hold?.revertAt ?? '',
    );

    expect(revertAt - before).toBeGreaterThanOrEqual(90_000 - 5000);
    expect(revertAt - before).toBeLessThanOrEqual(90_000 + 15_000);
  });

  it('The owner picked another selector', async () => {
    const turn = await seedFailedTurn();

    // A steer stored `@fast` while the Run was live: its revision moved.
    await tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).setModelSelection(turn.chatId, userId, {
        revision: 2,
        selector: '@fast',
        effort: null,
      }),
    );

    const admitted = await admit(turn, nextCandidateRequest);

    const run = (await runsOf(turn.chatId)).find(
      (candidate) => candidate.id === admitted.runId,
    );

    expect((await chatOf(turn.chatId))?.modelSelection).toEqual({
      revision: 2,
      selector: '@fast',
      effort: null,
    });
    expect(run?.selectionRevision).toBe(2);
  });

  it('The owner picked the same role during the Run', async () => {
    const turn = await seedFailedTurn();

    // Re-picking the same role still moves the revision, so the switch holds
    // nothing.
    await tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).setModelSelection(turn.chatId, userId, {
        revision: 2,
        selector: '@coding',
        effort: 'high',
      }),
    );

    await admit(turn, nextCandidateRequest);

    expect((await chatOf(turn.chatId))?.modelSelection).toEqual({
      revision: 2,
      selector: '@coding',
      effort: 'high',
    });
  });
});
