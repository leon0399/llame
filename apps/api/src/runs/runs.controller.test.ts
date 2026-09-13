import { ConflictException, Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import {
  type Run,
  type RunEvent,
  type SystemPromptReceipt,
} from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { RunAbortRegistry } from './run-abort-registry';
import { RunsController } from './runs.controller';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { SystemPromptReceiptsRepository } from './system-prompt-receipts.repository';

type RunEventRequest = Parameters<RunsController['streamRunEvents']>[3];
type RunEventResponse = Parameters<RunsController['streamRunEvents']>[4];

describe('RunsController context receipt', () => {
  const run: Run = {
    id: '11111111-1111-4111-8111-111111111111',
    chatId: '22222222-2222-4222-8222-222222222222',
    messageId: '33333333-3333-4333-8333-333333333333',
    userId: 'owner',
    modelId: 'system:openai:public-model',
    modelContextSnapshotId: '44444444-4444-4444-8444-444444444444',
    effort: null,
    activeAttemptId: null,
    completedAttemptId: null,
    turnToolAvailability: null,
    status: 'completed',
    workerId: null,
    cancelRequestedAt: null,
    error: null,
    contextItems: null,
    createdAt: new Date('2026-07-18T10:00:00.000Z'),
    startedAt: new Date('2026-07-18T10:00:01.000Z'),
    finishedAt: new Date('2026-07-18T10:00:02.000Z'),
  };
  const promptReceipt: SystemPromptReceipt = {
    id: '55555555-5555-4555-8555-555555555555',
    ownerUserId: 'owner',
    runId: run.id,
    attemptId: '66666666-6666-4666-8666-666666666666',
    source: 'model_override',
    systemPrompt: 'Complete effective prompt',
    promptHash: 'prompt-hash',
    createdAt: new Date('2026-07-18T09:59:59.000Z'),
  };

  afterEach(() => vi.restoreAllMocks());

  function controller(aborts = new RunAbortRegistry()) {
    const tx: Db = drizzle.mock({ schema });
    const runAs: TenantRunner['runAs'] = async <T>(
      _userId: string,
      callback: (scoped: Db) => Promise<T>,
    ) => callback(tx);
    const tenantDb: TenantRunner = { runAs };
    vi.spyOn(tenantDb, 'runAs');

    return new RunsController(tenantDb, aborts);
  }

  function request(
    headers: RunEventRequest['headers'] = {},
    destroyed = false,
  ): RunEventRequest {
    return { headers, destroyed };
  }

  function response() {
    const writes: Array<string> = [];
    const status = vi.fn().mockReturnThis();
    const setHeader = vi.fn().mockReturnThis();
    const flushHeaders = vi.fn();
    const write = vi.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    });
    const end = vi.fn();
    const value: RunEventResponse = {
      writableEnded: false,
      status,
      setHeader,
      flushHeaders,
      write,
      end,
    };
    return { value, writes, status, setHeader, flushHeaders, write, end };
  }

  it('returns owner-visible system-prompt receipt fields', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(run);
    vi.spyOn(
      SystemPromptReceiptsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue([promptReceipt]);

    const receipt = await controller().getContextReceipt('owner', run.id);

    expect(receipt).toEqual({
      modelId: 'system:openai:public-model',
      state: 'prepared',
      receipts: [
        {
          attemptId: promptReceipt.attemptId,
          promptSource: 'model_override',
          systemPrompt: 'Complete effective prompt',
          promptHash: 'prompt-hash',
          createdAt: promptReceipt.createdAt,
        },
      ],
      createdAt: run.createdAt,
    });
    expect(JSON.stringify(receipt)).not.toMatch(
      /providerModelId|credential|executor|authorization|ownerUserId|runId|path/i,
    );
  });

  it('returns an owned run', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(run);

    await expect(controller().getRun('owner', run.id)).resolves.toMatchObject({
      id: run.id,
      status: 'completed',
    });
  });

  it('returns not-found when an owned run lookup misses', async () => {
    const findById = vi
      .spyOn(RunsRepository.prototype, 'findById')
      .mockResolvedValue(undefined);

    await expect(controller().getRun('owner', run.id)).rejects.toThrow(
      `Run ${run.id} not found`,
    );
    // A run owned by someone else reaches the same 404 only because the lookup
    // is scoped to the authenticated caller, never to a client-supplied id.
    expect(findById).toHaveBeenCalledWith(run.id, 'owner');
  });

  it('discloses no context items for a run another owner holds', async () => {
    const findById = vi
      .spyOn(RunsRepository.prototype, 'findById')
      .mockResolvedValue(undefined);

    await expect(
      controller().getContextItems('intruder', run.id),
    ).rejects.toThrow(`Run ${run.id} not found`);
    // The lookup carries the authenticated caller, never an id the client
    // chose, so another owner's run is indistinguishable from a missing one -
    // and no item, count, or producer name leaks through the difference.
    expect(findById).toHaveBeenCalledWith(run.id, 'intruder');
  });

  it('requests cancellation and aborts an in-process run', async () => {
    const running = { ...run, status: 'running_model' as const };
    vi.spyOn(RunsRepository.prototype, 'requestCancel').mockResolvedValue(
      running,
    );
    const aborts = new RunAbortRegistry();
    const abort = vi.spyOn(aborts, 'abort');

    await expect(
      controller(aborts).updateRun('owner', run.id, { status: 'cancelled' }),
    ).resolves.toMatchObject({ id: run.id, status: 'running_model' });
    expect(abort).toHaveBeenCalledWith(run.id);
  });

  it('rejects cancellation after a run reached every terminal status', async () => {
    vi.spyOn(RunsRepository.prototype, 'requestCancel').mockResolvedValue(
      undefined,
    );
    const find = vi.spyOn(RunsRepository.prototype, 'findById');

    for (const status of [
      'completed',
      'failed',
      'cancelled',
      'expired',
    ] as const) {
      find.mockResolvedValueOnce({ ...run, status });
      await expect(
        controller().updateRun('owner', run.id, { status: 'cancelled' }),
      ).rejects.toBeInstanceOf(ConflictException);
    }
  });

  it('treats an already requested nonterminal cancellation as idempotent', async () => {
    const cancelling = {
      ...run,
      status: 'running_model' as const,
      cancelRequestedAt: new Date('2026-07-18T10:00:01.500Z'),
    };
    vi.spyOn(RunsRepository.prototype, 'requestCancel').mockResolvedValue(
      undefined,
    );
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(
      cancelling,
    );

    await expect(
      controller().updateRun('owner', run.id, { status: 'cancelled' }),
    ).resolves.toMatchObject({ id: run.id, status: 'running_model' });
  });

  it('returns not-produced for a terminal run without a prompt receipt', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(run);
    vi.spyOn(
      SystemPromptReceiptsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue([]);

    const receipt = await controller().getContextReceipt('owner', run.id);

    expect(receipt).toEqual({
      modelId: run.modelId,
      state: 'not_produced',
      receipts: [],
      createdAt: run.createdAt,
    });
  });

  it('returns active and completed attempt identities with receipts', async () => {
    const attemptedRun: Run = {
      ...run,
      activeAttemptId: promptReceipt.attemptId,
      completedAttemptId: promptReceipt.attemptId,
    };
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(
      attemptedRun,
    );
    vi.spyOn(
      SystemPromptReceiptsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue([promptReceipt]);

    const receipt = await controller().getContextReceipt(
      'owner',
      attemptedRun.id,
    );

    expect(receipt).toEqual({
      modelId: attemptedRun.modelId,
      activeAttemptId: promptReceipt.attemptId,
      completedAttemptId: promptReceipt.attemptId,
      state: 'prepared',
      receipts: [
        {
          attemptId: promptReceipt.attemptId,
          promptSource: promptReceipt.source,
          systemPrompt: promptReceipt.systemPrompt,
          promptHash: promptReceipt.promptHash,
          createdAt: promptReceipt.createdAt,
        },
      ],
      createdAt: attemptedRun.createdAt,
    });
  });

  it('returns pending for a nonterminal run without a prompt receipt', async () => {
    const pendingRun: Run = { ...run, status: 'queued' };
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(
      pendingRun,
    );
    vi.spyOn(
      SystemPromptReceiptsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue([]);

    const receipt = await controller().getContextReceipt(
      'owner',
      pendingRun.id,
    );

    expect(receipt).toEqual({
      modelId: pendingRun.modelId,
      state: 'pending',
      receipts: [],
      createdAt: pendingRun.createdAt,
    });
  });

  it('streams a completed run tail and closes with DONE', async () => {
    const event: RunEvent = {
      runId: run.id,
      sequence: 7,
      eventType: 'run.completed',
      payload: { finishReason: 'stop' },
      createdAt: new Date('2026-07-18T10:00:02.000Z'),
    };
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(run);
    const list = vi
      .spyOn(RunEventsRepository.prototype, 'listByRunId')
      .mockResolvedValueOnce([event])
      .mockResolvedValueOnce([]);
    const output = response();

    await controller().streamRunEvents(
      'owner',
      run.id,
      { after_sequence: 2 },
      request({ 'last-event-id': '6' }),
      output.value,
    );

    expect(output.status).toHaveBeenCalledWith(200);
    expect(output.setHeader).toHaveBeenCalledWith(
      'content-type',
      'text/event-stream',
    );
    expect(output.setHeader).toHaveBeenCalledWith(
      'cache-control',
      'no-cache, no-transform',
    );
    expect(output.setHeader).toHaveBeenCalledWith('connection', 'keep-alive');
    expect(output.flushHeaders).toHaveBeenCalledOnce();
    expect(list).toHaveBeenNthCalledWith(1, run.id, 'owner', {
      afterSequence: 6,
    });
    expect(list).toHaveBeenNthCalledWith(2, run.id, 'owner', {
      afterSequence: 7,
    });
    expect(output.writes).toEqual([
      `id: 7\ndata: ${JSON.stringify({
        sequence: 7,
        eventType: 'run.completed',
        payload: { finishReason: 'stop' },
        createdAt: event.createdAt,
      })}\n\n`,
      'data: [DONE]\n\n',
    ]);
    expect(output.end).toHaveBeenCalledOnce();
  });

  it('redacts a bash attempt path from owner SSE without changing stored events', async () => {
    const events: Array<RunEvent> = [
      {
        runId: run.id,
        sequence: 7,
        eventType: 'native.attempt',
        payload: {
          toolCallId: 'bash-call',
          operation: 'bash',
          path: '/srv/private-project',
        },
        createdAt: new Date('2026-07-18T10:00:01.000Z'),
      },
      {
        runId: run.id,
        sequence: 8,
        eventType: 'native.attempt',
        payload: {
          toolCallId: 'edit-call',
          operation: 'edit',
          path: '/tmp/file.txt',
        },
        createdAt: new Date('2026-07-18T10:00:01.500Z'),
      },
      {
        runId: run.id,
        sequence: 9,
        eventType: 'native.result',
        payload: {
          toolCallId: 'edit-call',
          result: { status: 'success', path: '/tmp/file.txt' },
        },
        createdAt: new Date('2026-07-18T10:00:02.000Z'),
      },
    ];
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(run);
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId')
      .mockResolvedValueOnce(events)
      .mockResolvedValueOnce([]);
    const output = response();

    await controller().streamRunEvents(
      'owner',
      run.id,
      {},
      request(),
      output.value,
    );

    expect(events[0].payload).toEqual({
      toolCallId: 'bash-call',
      operation: 'bash',
      path: '/srv/private-project',
    });
    expect(output.writes).toEqual([
      `id: 7\ndata: ${JSON.stringify({
        sequence: 7,
        eventType: 'native.attempt',
        payload: { toolCallId: 'bash-call', operation: 'bash' },
        createdAt: events[0].createdAt,
      })}\n\n`,
      `id: 8\ndata: ${JSON.stringify({
        sequence: 8,
        eventType: 'native.attempt',
        payload: events[1].payload,
        createdAt: events[1].createdAt,
      })}\n\n`,
      `id: 9\ndata: ${JSON.stringify({
        sequence: 9,
        eventType: 'native.result',
        payload: events[2].payload,
        createdAt: events[2].createdAt,
      })}\n\n`,
      'data: [DONE]\n\n',
    ]);
  });

  it.each([
    { header: undefined, query: 3, expected: 3 },
    { header: '', query: 4, expected: 4 },
    { header: ' ', query: 5, expected: 5 },
    { header: '-1', query: 6, expected: 6 },
    { header: '1.5', query: 7, expected: 7 },
    { header: ['8', '9'], query: 1, expected: 8 },
  ])('selects a safe replay cursor: $header', async (example) => {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(run);
    const list = vi
      .spyOn(RunEventsRepository.prototype, 'listByRunId')
      .mockResolvedValue([]);
    const output = response();
    const headers =
      example.header === undefined ? {} : { 'last-event-id': example.header };

    await controller().streamRunEvents(
      'owner',
      run.id,
      { after_sequence: example.query },
      request(headers),
      output.value,
    );

    expect(list).toHaveBeenCalledWith(run.id, 'owner', {
      afterSequence: example.expected,
    });
  });

  it('refreshes a running run after events and closes after its terminal tail', async () => {
    const running = { ...run, status: 'running_model' as const };
    const event: RunEvent = {
      runId: run.id,
      sequence: 1,
      eventType: 'run.completed',
      payload: null,
      createdAt: new Date('2026-07-18T10:00:02.000Z'),
    };
    vi.spyOn(RunsRepository.prototype, 'findById')
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(run);
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId')
      .mockResolvedValueOnce([event])
      .mockResolvedValueOnce([]);
    const output = response();

    await controller().streamRunEvents(
      'owner',
      run.id,
      {},
      request(),
      output.value,
    );

    expect(output.writes.at(-1)).toBe('data: [DONE]\n\n');
  });

  it('closes without DONE when the run is deleted after an event', async () => {
    const running = { ...run, status: 'running_model' as const };
    const event: RunEvent = {
      runId: run.id,
      sequence: 1,
      eventType: 'assistant.delta',
      payload: { delta: 'hello' },
      createdAt: new Date('2026-07-18T10:00:02.000Z'),
    };
    vi.spyOn(RunsRepository.prototype, 'findById')
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(undefined);
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue([
      event,
    ]);
    const output = response();

    await controller().streamRunEvents(
      'owner',
      run.id,
      {},
      request(),
      output.value,
    );

    expect(output.writes).toHaveLength(1);
    expect(output.writes[0]).toContain('assistant.delta');
    expect(output.end).toHaveBeenCalledOnce();
  });

  it('ends immediately when the client disconnected', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue({
      ...run,
      status: 'running_model',
    });
    const list = vi.spyOn(RunEventsRepository.prototype, 'listByRunId');
    const output = response();

    await controller().streamRunEvents(
      'owner',
      run.id,
      {},
      request({}, true),
      output.value,
    );

    expect(list).not.toHaveBeenCalled();
    expect(output.writes).toEqual([]);
    expect(output.end).toHaveBeenCalledOnce();
  });

  it('logs a post-header stream failure and still closes', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(run);
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockRejectedValue(
      'database unavailable',
    );
    const logger = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const output = response();

    await controller().streamRunEvents(
      'owner',
      run.id,
      {},
      request(),
      output.value,
    );

    expect(logger).toHaveBeenCalledWith(
      `Run event stream failed for run ${run.id}`,
      'database unavailable',
    );
    expect(output.end).toHaveBeenCalledOnce();
  });
});
