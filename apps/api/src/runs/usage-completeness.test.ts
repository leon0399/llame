import { drizzle } from 'drizzle-orm/postgres-js';

import { MessagesRepository } from '../chats/chats-repository';
import * as schema from '../db/schema';
import {
  type Run,
  type RunEvent,
  type SystemPromptReceipt,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type AssistantTurnTelemetry } from './run-reply-finalizer';
import { RunEventsRepository } from './runs-repository';
import { SystemPromptReceiptsRepository } from './system-prompt-receipts.repository';
import { finalizeUsageCompleteness } from './usage-completeness';

const runId = '11111111-1111-4111-8111-111111111111';
const userId = 'user-1';
const now = new Date('2026-11-08T00:00:00.000Z');

const run: Run = {
  id: runId,
  chatId: '22222222-2222-4222-8222-222222222222',
  messageId: '33333333-3333-4333-8333-333333333333',
  userId,
  modelId: 'fake-model',
  activeAttemptId: 'current',
  completedAttemptId: null,
  turnToolAvailability: null,
  status: 'completed',
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  createdAt: now,
  startedAt: now,
  finishedAt: now,
  wakeGeneration: 0,
  currentJobId: null,
  awaiting: null,
  effort: null,
  permissionMode: 'default',
  followUpAction: null,
  sourceRunId: null,
};

function receipt(attemptId: string): SystemPromptReceipt {
  return {
    id: crypto.randomUUID(),
    ownerUserId: userId,
    runId,
    attemptId,
    source: 'project_default',
    systemPrompt: 'prompt',
    promptHash: 'hash',
    createdAt: now,
  };
}

function event(
  sequence: number,
  eventType: RunEvent['eventType'],
  payload: RunEvent['payload'],
): RunEvent {
  return { sequence, runId, eventType, payload, createdAt: now };
}

describe('finalizeUsageCompleteness', () => {
  const tx: Db = drizzle.mock({ schema });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The reads a finalization makes: the Run's receipts, its latest delivery
   * and the `run.started` events after it, and the `run.created` flags.
   */
  function serve(state: {
    receipts?: Array<string>;
    delivered?: RunEvent;
    started?: Array<RunEvent>;
    replacesUsage?: boolean;
  }) {
    vi.spyOn(
      SystemPromptReceiptsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue((state.receipts ?? []).map(receipt));

    const findFirst = vi
      .spyOn(RunEventsRepository.prototype, 'findFirstByType')
      .mockImplementation((_runId, _userId, eventType) =>
        Promise.resolve(
          eventType === 'run.delivered'
            ? state.delivered
            : event(1, 'run.created', {
                replacesUsage: state.replacesUsage === true,
              }),
        ),
      );

    const list = vi
      .spyOn(RunEventsRepository.prototype, 'listByRunId')
      .mockResolvedValue(state.started ?? []);

    const findTurnState = vi.spyOn(
      MessagesRepository.prototype,
      'findTurnState',
    );

    return { findFirst, list, findTurnState };
  }

  async function finalize(
    overrides: {
      run?: Run;
      closedBySteer?: boolean;
    } = {},
  ): Promise<AssistantTurnTelemetry> {
    const telemetry: AssistantTurnTelemetry = {
      runId,
      attemptId: 'current',
      modelId: 'fake-model',
      latencyMs: 10,
      finishReason: 'stop',
      status: 'completed',
      complete: true,
    };

    await finalizeUsageCompleteness(tx, {
      userId,
      runId,
      attemptId: 'current',
      run: overrides.run ?? run,
      chatId: undefined,
      inReplyTo: undefined,
      telemetry,
      ...(overrides.closedBySteer !== undefined && {
        closedBySteer: overrides.closedBySteer,
      }),
    });

    return telemetry;
  }

  it('counts an attempt the latest delivery names as another attempt of the segment', async () => {
    const spies = serve({
      receipts: ['delivered-attempt'],
      delivered: event(5, 'run.delivered', { attemptId: 'delivered-attempt' }),
    });

    expect((await finalize()).complete).toBe(false);
    expect(spies.list).toHaveBeenCalledWith(runId, userId, {
      eventTypes: ['run.started'],
      afterSequence: 5,
    });
  });

  it('counts an attempt that claimed the Run after the delivery as another attempt of the segment', async () => {
    serve({
      receipts: ['claimed-after'],
      delivered: event(5, 'run.delivered', { attemptId: 'delivered-attempt' }),
      started: [event(6, 'run.started', { attemptId: 'claimed-after' })],
    });

    expect((await finalize()).complete).toBe(false);
  });

  it('ignores an attempt of an earlier segment', async () => {
    serve({
      receipts: ['earlier-segment'],
      delivered: event(5, 'run.delivered', { attemptId: 'delivered-attempt' }),
      started: [event(6, 'run.started', { attemptId: 'claimed-after' })],
    });

    expect((await finalize()).complete).toBe(true);
  });

  it('counts every other attempt when the Run has not delivered', async () => {
    serve({ receipts: ['earlier'] });

    expect((await finalize()).complete).toBe(false);
  });

  it('reads no segment when no receipt names another attempt and no follow-up is in play', async () => {
    const spies = serve({ receipts: ['current'] });

    expect((await finalize()).complete).toBe(true);
    expect(spies.findFirst).not.toHaveBeenCalled();
  });

  it('leaves a follow-up that delivered to its first segment out of the replacement flag', async () => {
    serve({
      delivered: event(5, 'run.delivered', { attemptId: 'delivered-attempt' }),
      replacesUsage: true,
    });

    expect(
      (await finalize({ run: { ...run, followUpAction: 'regenerate' } }))
        .complete,
    ).toBe(true);
  });

  it('reads the replacement flag of a follow-up that has not delivered', async () => {
    serve({ replacesUsage: true });

    expect(
      (await finalize({ run: { ...run, followUpAction: 'regenerate' } }))
        .complete,
    ).toBe(false);
  });

  it('closes a live Run complete when a steer closes it', async () => {
    serve({});
    const live: Run = { ...run, status: 'running_model' };

    expect((await finalize({ run: live, closedBySteer: true })).complete).toBe(
      true,
    );
  });

  it('keeps a live Run incomplete when no steer closes it', async () => {
    serve({});
    const live: Run = { ...run, status: 'running_model' };

    expect((await finalize({ run: live })).complete).toBe(false);
    expect((await finalize({ run: live, closedBySteer: false })).complete).toBe(
      false,
    );
  });
});
