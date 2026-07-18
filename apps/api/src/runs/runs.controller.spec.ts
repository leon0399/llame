import { NotFoundException } from '@nestjs/common';

import { type ModelContextSnapshot, type Run } from '../db/schema';
import { type TenantDbService } from '../db/tenant-db.service';
import { RunAbortRegistry } from './run-abort-registry';
import { RunsController } from './runs.controller';
import { RunsRepository } from './runs-repository';
import { ModelContextSnapshotsRepository } from './model-context-snapshots.repository';

describe('RunsController context receipt', () => {
  const run: Run = {
    id: '11111111-1111-4111-8111-111111111111',
    chatId: '22222222-2222-4222-8222-222222222222',
    messageId: '33333333-3333-4333-8333-333333333333',
    userId: 'owner',
    modelId: 'system:openai:public-model',
    modelContextSnapshotId: '44444444-4444-4444-8444-444444444444',
    status: 'completed',
    workerId: null,
    cancelRequestedAt: null,
    error: null,
    createdAt: new Date('2026-07-18T10:00:00.000Z'),
    startedAt: new Date('2026-07-18T10:00:01.000Z'),
    finishedAt: new Date('2026-07-18T10:00:02.000Z'),
  };
  const snapshot: ModelContextSnapshot = {
    id: run.modelContextSnapshotId!,
    ownerUserId: 'owner',
    contentHash: 'content-hash',
    promptHash: 'prompt-hash-must-not-leak',
    toolHash: 'tool-hash-must-not-leak',
    source: 'model_override',
    systemPrompt: 'Complete effective prompt',
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

  afterEach(() => jest.restoreAllMocks());

  function controller() {
    const tx = {};
    const tenantDb = {
      runAs: jest.fn(
        (_userId: string, callback: (scoped: unknown) => Promise<unknown>) =>
          callback(tx),
      ),
    } as unknown as TenantDbService;

    return new RunsController(tenantDb, new RunAbortRegistry());
  }

  it('returns only the owner-visible immutable effective-context fields', async () => {
    jest.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(run);
    jest
      .spyOn(ModelContextSnapshotsRepository.prototype, 'findByOwnedRun')
      .mockResolvedValue(snapshot);

    const receipt = await controller().getContextReceipt('owner', run.id);

    expect(receipt).toEqual({
      modelId: 'system:openai:public-model',
      promptSource: 'model_override',
      systemPrompt: 'Complete effective prompt',
      tools: snapshot.toolDeclarations,
      contentHash: 'content-hash',
      createdAt: new Date('2026-07-18T09:59:59.000Z'),
    });
    expect(JSON.stringify(receipt)).not.toMatch(
      /providerModelId|credential|executor|authorization|ownerUserId|snapshotId|promptHash|toolHash|path/i,
    );
  });

  it('returns not-found when the run is missing or belongs to another owner', async () => {
    jest
      .spyOn(RunsRepository.prototype, 'findById')
      .mockResolvedValue(undefined);

    await expect(
      controller().getContextReceipt('other-user', run.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns not-found for a legacy run without an owned snapshot', async () => {
    jest.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(run);
    jest
      .spyOn(ModelContextSnapshotsRepository.prototype, 'findByOwnedRun')
      .mockResolvedValue(undefined);

    await expect(
      controller().getContextReceipt('owner', run.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
