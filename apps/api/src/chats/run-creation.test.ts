import { ConflictException } from '@nestjs/common';

import type { Message } from '../db/schema';
import type { Db } from '../db/tenant-db.service';
import { asDouble } from '../testing/support';
import { RunsRepository } from '../runs/runs-repository';
import { createCompactionRun, createRunForMessage } from './run-creation';

afterEach(() => vi.restoreAllMocks());

describe('createCompactionRun', () => {
  it('maps the in-flight Chat constraint to the owner-facing conflict', async () => {
    const tx = asDouble<Db>({
      transaction: async <T>(callback: (inner: Db) => Promise<T>) =>
        callback(asDouble<Db>({})),
    });

    const duplicate = Object.assign(new Error('duplicate'), {
      code: '23505',
      constraint_name: 'runs_chat_inflight_unique',
    });

    const createRun = vi
      .spyOn(RunsRepository.prototype, 'create')
      .mockRejectedValue(duplicate);

    await expect(
      createCompactionRun(tx, {
        id: 'run-1',
        chatId: 'chat-1',
        userId: 'owner-1',
        modelId: 'model-1',
        selector: 'model-1',
        focus: null,
        origin: 'agent',
      }),
    ).rejects.toThrow(
      new ConflictException('Another run is already in flight for this chat'),
    );
    expect(createRun.mock.calls[0]?.[0]).toMatchObject({ origin: 'agent' });
  });
});

describe('createRunForMessage', () => {
  it('maps a duplicate message Run to the owner-facing conflict', async () => {
    const tx = asDouble<Db>({
      transaction: async <T>(callback: (inner: Db) => Promise<T>) =>
        callback(asDouble<Db>({})),
    });

    const userMessage: Message = {
      id: 'message-1',
      chatId: 'chat-1',
      seq: 1,
      role: 'user',
      senderUserId: 'owner-1',
      parts: [],
      attachments: [],
      usage: null,
      absorbedThroughSeq: null,
      inReplyTo: null,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      revisedAt: null,
    };

    const duplicate = Object.assign(new Error('duplicate'), {
      code: '23505',
      constraint_name: 'runs_chat_inflight_unique',
    });

    vi.spyOn(
      RunsRepository.prototype,
      'cancelActiveRunsForMessage',
    ).mockResolvedValue([]);

    const createRun = vi
      .spyOn(RunsRepository.prototype, 'create')
      .mockRejectedValue(duplicate);

    await expect(
      createRunForMessage(
        tx,
        {
          userId: 'owner-1',
          chatId: 'chat-1',
          modelId: 'model-1',
          selector: 'model-1',
          effort: undefined,
          selectedEffort: undefined,
          selectionRevision: null,
          permissionMode: 'default',
          targetRunId: 'run-1',
          origin: 'agent',
        },
        userMessage,
      ),
    ).rejects.toThrow(
      new ConflictException('Another run is already in flight for this chat'),
    );
    expect(createRun.mock.calls[0]?.[0]).toMatchObject({ origin: 'agent' });
  });
});
