import { drizzle } from 'drizzle-orm/postgres-js';

import { MessagesRepository } from '../chats/chats-repository';
import { createContextItemPart } from '../chats/context-item';
import * as schema from '../db/schema';
import { type Message, type Run, type RunEvent } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import {
  attemptWindow,
  failRunTransactionally,
  finalizeRunReply,
  placeStoredContextItems,
  runningReplyUsage,
  type AssistantTurnTelemetry,
} from './run-reply-finalizer';
import { RunEventsRepository, RunsRepository } from './runs-repository';

const runId = '11111111-1111-4111-8111-111111111111';
const chatId = '22222222-2222-4222-8222-222222222222';
const messageId = '33333333-3333-4333-8333-333333333333';
const userId = 'user-1';
const now = new Date('2026-10-10T00:00:00.000Z');

const run: Run = {
  id: runId,
  chatId,
  messageId,
  userId,
  modelId: 'fake-model',
  activeAttemptId: null,
  completedAttemptId: null,
  turnToolAvailability: null,
  status: 'failed',
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  createdAt: now,
  startedAt: now,
  finishedAt: now,
  effort: null,
  permissionMode: 'default',
};

const userMessage: Message = {
  id: messageId,
  chatId,
  seq: 1,
  role: 'user',
  senderUserId: userId,
  parts: [{ type: 'text', text: 'hello' }],
  attachments: [],
  usage: null,
  absorbedThroughSeq: null,
  inReplyTo: null,
  createdAt: now,
};

const models = [{ id: 'fake-model', billing: 'subscription' as const }];

function event(
  sequence: number,
  eventType: string,
  payload: RunEvent['payload'],
): RunEvent {
  return { sequence, runId, eventType, payload, createdAt: now };
}

function requested(sequence: number, attemptId?: string): RunEvent {
  return event(sequence, 'model.requested', {
    modelId: 'fake-model',
    ...(attemptId !== undefined && { attemptId }),
  });
}

function toolCall(sequence: number, toolCallId: string): Array<RunEvent> {
  return [
    event(sequence, 'tool.requested', {
      toolCallId,
      toolName: 'search',
      input: { q: toolCallId },
    }),
    event(sequence + 1, 'tool.completed', {
      toolCallId,
      toolName: 'search',
      status: 'success',
      output: { status: 'success', value: 'ok' },
    }),
  ];
}

function toolPart(toolCallId: string) {
  return { type: 'tool-search', toolCallId };
}

function contextItem(text: string) {
  return createContextItemPart({
    producer: 'instructions',
    runId,
    payload: {},
    text,
  });
}

function reply(input: {
  usage: Message['usage'];
  parts?: Message['parts'];
}): Message {
  return {
    ...userMessage,
    id: '44444444-4444-4444-8444-444444444444',
    seq: 2,
    role: 'assistant',
    senderUserId: null,
    parts: input.parts ?? [],
    usage: input.usage,
    inReplyTo: messageId,
  };
}

function telemetry(attemptId: string): AssistantTurnTelemetry {
  return {
    runId,
    attemptId,
    modelId: 'fake-model',
    latencyMs: 10,
    finishReason: null,
    status: 'error',
    complete: false,
  };
}

describe('attemptWindow', () => {
  it("spans the named attempt's request up to the next attempt's start", () => {
    const log = [
      event(1, 'run.started', null),
      requested(2, 'a'),
      event(3, 'model.delta', { text: 'from a' }),
      event(4, 'run.started', null),
      requested(5, 'b'),
      event(6, 'model.delta', { text: 'from b' }),
      event(7, 'run.started', null),
      event(8, 'model.delta', { text: 'never dispatched' }),
    ];

    expect(attemptWindow(log, 'a').map(({ sequence }) => sequence)).toEqual([
      2, 3,
    ]);
    expect(attemptWindow(log, 'b').map(({ sequence }) => sequence)).toEqual([
      5, 6,
    ]);
  });

  it('runs to the end of the log for the last attempt and skips legacy requests', () => {
    const log = [
      event(1, 'run.started', null),
      requested(2),
      event(3, 'model.delta', { text: 'legacy' }),
      event(4, 'run.started', null),
      requested(5, 'a'),
      event(6, 'model.delta', { text: 'from a' }),
    ];

    expect(attemptWindow(log, 'a').map(({ sequence }) => sequence)).toEqual([
      5, 6,
    ]);
    expect(attemptWindow(log, 'unknown')).toEqual([]);
  });
});

describe('placeStoredContextItems', () => {
  it('places an item after the last surviving tool part that preceded it', () => {
    const item = contextItem('rules');

    expect(
      placeStoredContextItems(
        [toolPart('t2'), toolPart('t1')],
        [toolPart('t1'), toolPart('t2'), item],
      ),
    ).toEqual([toolPart('t2'), toolPart('t1'), item]);
  });

  it('places an item first when none of its preceding tool parts survive', () => {
    const item = contextItem('rules');
    const text = { type: 'text', text: 'answer' };

    expect(
      placeStoredContextItems([text], [toolPart('t1'), toolPart('t2'), item]),
    ).toEqual([item, text]);
  });

  it('keeps the snapshot order of items sharing an anchor', () => {
    const first = contextItem('first');
    const second = contextItem('second');

    expect(
      placeStoredContextItems(
        [toolPart('t1'), toolPart('t2')],
        [toolPart('t1'), first, second],
      ),
    ).toEqual([toolPart('t1'), first, second, toolPart('t2')]);
  });

  it('anchors each item on the tool parts that preceded it alone', () => {
    const first = contextItem('first');
    const second = contextItem('second');
    const text = { type: 'text', text: 'answer' };

    expect(
      placeStoredContextItems(
        [toolPart('t1'), toolPart('t2'), text],
        [toolPart('t1'), first, toolPart('t2'), second],
      ),
    ).toEqual([toolPart('t1'), first, toolPart('t2'), second, text]);
  });
});

describe('finalizeRunReply', () => {
  const tx: Db = drizzle.mock({ schema });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function serve(input: { log: Array<RunEvent>; reply?: Message }) {
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue(
      input.log,
    );
    const append = vi
      .spyOn(RunEventsRepository.prototype, 'append')
      .mockImplementation((appendedRunId, eventType, payload) =>
        Promise.resolve({
          sequence: 99,
          runId: appendedRunId,
          eventType,
          payload,
          createdAt: now,
        }),
      );
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage,
      assistantMessage: input.reply,
    });
    const update = vi
      .spyOn(MessagesRepository.prototype, 'updateAssistantReply')
      .mockImplementation(() => Promise.resolve(input.reply));
    const create = vi
      .spyOn(MessagesRepository.prototype, 'createAssistantReplyIfAbsent')
      .mockResolvedValue(reply({ usage: { status: 'error' } }));
    return { append, update, create };
  }

  it('writes no reply and no usage for a Run that never dispatched', async () => {
    const { update, create } = serve({ log: [event(1, 'run.started', null)] });

    await expect(
      finalizeRunReply(tx, { run, status: 'cancelled', models }),
    ).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a legacy Run's reply from its full log with token-less usage", async () => {
    const { create } = serve({
      log: [requested(1), event(2, 'model.delta', { text: 'legacy answer' })],
    });

    await finalizeRunReply(tx, {
      run: { ...run, effort: 'high' },
      status: 'expired',
      models,
    });

    expect(create).toHaveBeenCalledWith({
      chatId,
      inReplyTo: messageId,
      parts: [{ type: 'text', text: 'legacy answer' }],
      usage: {
        status: 'aborted',
        complete: false,
        runId,
        modelId: 'fake-model',
        effort: 'high',
        billing: 'subscription',
      },
    });
  });

  it("rebuilds the named attempt's reply around its stored items with that attempt's identity", async () => {
    const item = contextItem('rules');
    const running = runningReplyUsage({
      runId,
      attemptId: 'a',
      modelId: 'fake-model',
      effort: 'high',
      permissionMode: 'bypass',
    });
    const { update } = serve({
      log: [
        event(1, 'run.started', null),
        requested(2, 'a'),
        ...toolCall(3, 't1'),
        event(5, 'model.delta', { text: 'after the rules' }),
        // Attempt b started and failed before its own dispatch.
        event(6, 'run.started', null),
      ],
      reply: reply({ usage: running, parts: [toolPart('t1'), item] }),
    });

    await finalizeRunReply(tx, {
      run,
      status: 'failed',
      attemptId: 'b',
      models,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          expect.objectContaining({ toolCallId: 't1' }),
          item,
          { type: 'text', text: 'after the rules' },
        ],
        usage: {
          status: 'error',
          complete: false,
          runId,
          attemptId: 'a',
          modelId: 'fake-model',
          effort: 'high',
          permissionMode: 'bypass',
          billing: 'subscription',
        },
      }),
    );
  });

  it("settles a call the attempt left open and keeps an earlier attempt's output out", async () => {
    const { append, update } = serve({
      log: [
        requested(1, 'a'),
        event(2, 'model.delta', { text: 'from a' }),
        event(3, 'run.started', null),
        requested(4, 'b'),
        event(5, 'tool.requested', {
          toolCallId: 'open',
          toolName: 'search',
          input: {},
        }),
      ],
      reply: reply({
        usage: runningReplyUsage({
          runId,
          attemptId: 'b',
          modelId: 'fake-model',
          effort: undefined,
          permissionMode: 'default',
        }),
      }),
    });

    await finalizeRunReply(tx, {
      run,
      status: 'failed',
      attemptId: 'b',
      telemetry: telemetry('b'),
      models,
    });

    expect(append).toHaveBeenCalledWith(
      runId,
      'tool.completed',
      expect.objectContaining({ toolCallId: 'open', status: 'error' }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [expect.objectContaining({ toolCallId: 'open' })],
        // The settling attempt is the reply's, so its own telemetry wins.
        usage: telemetry('b'),
      }),
    );
  });

  it('leaves a completed reply untouched', async () => {
    const { update, create } = serve({
      log: [requested(1, 'a')],
      reply: reply({ usage: { status: 'completed' } }),
    });

    await finalizeRunReply(tx, { run, status: 'failed', models });

    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("never writes a live turn over another attempt's running reply", async () => {
    const { update } = serve({
      log: [requested(1, 'b')],
      reply: reply({
        usage: runningReplyUsage({
          runId,
          attemptId: 'b',
          modelId: 'fake-model',
          effort: undefined,
          permissionMode: 'default',
        }),
      }),
    });

    await finalizeRunReply(tx, {
      run,
      status: 'failed',
      attemptId: 'a',
      live: {
        chatId,
        inReplyTo: messageId,
        parts: [{ type: 'text', text: 'stale' }],
        telemetry: telemetry('a'),
      },
      models,
    });

    expect(update).not.toHaveBeenCalled();
  });
});

describe('failRunTransactionally', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finalizes the reply and appends run.failed only when the terminal update wins', async () => {
    const db: Db = drizzle.mock({ schema });
    const runAsCalls: Array<string> = [];
    const tenantDb = {
      runAs<T>(runAsUserId: string, callback: (tx: Db) => Promise<T>) {
        runAsCalls.push(runAsUserId);
        return callback(db);
      },
    } satisfies TenantRunner;
    vi.spyOn(RunsRepository.prototype, 'markFinished')
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce(undefined);
    const listByRunId = vi
      .spyOn(RunEventsRepository.prototype, 'listByRunId')
      .mockResolvedValue([]);
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage,
      assistantMessage: undefined,
    });
    const append = vi
      .spyOn(RunEventsRepository.prototype, 'append')
      .mockResolvedValue(event(1, 'run.failed', null));

    await failRunTransactionally(
      tenantDb,
      { runId, userId },
      'failed once',
      models,
    );
    await failRunTransactionally(
      tenantDb,
      { runId, userId },
      'late failure',
      models,
    );

    expect(runAsCalls).toEqual([userId, userId]);
    expect(listByRunId).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith(runId, 'run.failed', {
      status: 'failed',
      message: 'failed once',
    });
    expect(listByRunId.mock.invocationCallOrder[0]).toBeLessThan(
      append.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
