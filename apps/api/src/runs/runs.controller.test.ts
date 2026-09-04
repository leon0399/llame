import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import {
  type ModelContextSnapshot,
  type Run,
  type RunEvent,
} from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { RunAbortRegistry } from './run-abort-registry';
import { RunsController } from './runs.controller';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { ModelContextSnapshotsRepository } from './model-context-snapshots.repository';

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
    status: 'completed',
    workerId: null,
    cancelRequestedAt: null,
    error: null,
    contextItems: null,
    createdAt: new Date('2026-07-18T10:00:00.000Z'),
    startedAt: new Date('2026-07-18T10:00:01.000Z'),
    finishedAt: new Date('2026-07-18T10:00:02.000Z'),
  };
  const snapshot: ModelContextSnapshot = {
    id: run.modelContextSnapshotId!,
    ownerUserId: 'owner',
    availabilityHash:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    contentHash: 'content-hash',
    promptHash: 'prompt-hash-must-not-leak',
    toolHash: 'tool-hash-must-not-leak',
    source: 'model_override',
    systemPrompt: 'Complete effective prompt',
    toolAvailabilityManifest: {
      version: 1,
      entries: [
        {
          id: 'search_conversations',
          state: 'available',
          declarationHash:
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      ],
    },
    toolDeclarations: [
      {
        id: 'search_conversations',
        description: 'Search your conversations',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ],
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

  it('returns only the owner-visible immutable effective-context fields', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(run);
    vi.spyOn(
      ModelContextSnapshotsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue(snapshot);

    const receipt = await controller().getContextReceipt('owner', run.id);

    expect(receipt).toEqual({
      modelId: 'system:openai:public-model',
      promptSource: 'model_override',
      systemPrompt: 'Complete effective prompt',
      tools: snapshot.toolDeclarations,
      availabilityHash:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      toolAvailability: {
        version: 1,
        entries: [
          {
            id: 'search_conversations',
            state: 'available',
            declarationHash:
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            label: 'available',
          },
        ],
      },
      contentHash: 'content-hash',
      createdAt: new Date('2026-07-18T09:59:59.000Z'),
    });
    expect(JSON.stringify(receipt)).not.toMatch(
      /providerModelId|credential|executor|authorization|ownerUserId|snapshotId|promptHash|toolHash|path/i,
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

  it('reports migrated v0 availability only as unobserved', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(run);
    vi.spyOn(
      ModelContextSnapshotsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue({
      ...snapshot,
      availabilityHash:
        '8c150f84f99edb30ec7fb866968b27db1bfc2d26e1be8a7e94ee61e565adf11e',
      toolAvailabilityManifest: { version: 0, state: 'unobserved' },
    });

    const receipt = await controller().getContextReceipt('owner', run.id);

    expect(receipt.toolAvailability).toEqual({
      version: 0,
      state: 'unobserved',
    });
    expect(receipt.toolAvailability).not.toHaveProperty('entries');
  });

  it('maps unavailable reasons to static labels without source diagnostics', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(run);
    const snapshotWithDiagnostics = {
      ...snapshot,
      toolAvailabilityManifest: {
        version: 1 as const,
        entries: [
          {
            id: 'mcp__web__search',
            state: 'unavailable' as const,
            reason: 'source_disconnected' as const,
          },
        ],
      },
      sourceDiagnostics: {
        url: 'https://private.example/mcp',
        error: 'AUTHORIZATION-SENTINEL',
      },
    };
    vi.spyOn(
      ModelContextSnapshotsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue(snapshotWithDiagnostics);

    const receipt = await controller().getContextReceipt('owner', run.id);

    expect(receipt.toolAvailability).toEqual({
      version: 1,
      entries: [
        {
          id: 'mcp__web__search',
          state: 'unavailable',
          reason: 'source_disconnected',
          label: 'server disconnected',
        },
      ],
    });
    expect(JSON.stringify(receipt)).not.toMatch(
      /private\.example|AUTHORIZATION-SENTINEL|sourceDiagnostics|url|error/i,
    );
  });

  it('returns not-found when the run is missing or belongs to another owner', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(undefined);

    await expect(
      controller().getContextReceipt('other-user', run.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns not-found for a legacy run without an owned snapshot', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(run);
    vi.spyOn(
      ModelContextSnapshotsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue(undefined);

    await expect(
      controller().getContextReceipt('owner', run.id),
    ).rejects.toBeInstanceOf(NotFoundException);
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
