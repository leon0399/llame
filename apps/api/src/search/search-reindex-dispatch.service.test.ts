import { Logger } from '@nestjs/common';

import { type Queue } from '../queue/queue';
import { SEARCH_REINDEX_QUEUE } from './reindex-queues';
import { SearchReindexDispatchService } from './search-reindex-dispatch.service';

function fakeQueue(overrides: {
  ensureQueue: Queue['ensureQueue'];
  enqueue: Queue['enqueue'];
}): Queue {
  return {
    ...overrides,
    consume: vi.fn(),
    schedule: vi.fn(),
    unschedule: vi.fn(),
    cancel: vi.fn(),
  };
}

describe('SearchReindexDispatchService.enqueueChatReindex', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ensures the queue and enqueues an owner-scoped chat with its singleton key', async () => {
    const ensureQueue = vi.fn().mockResolvedValue(undefined);
    const enqueue = vi.fn().mockResolvedValue('job-id');
    const service = new SearchReindexDispatchService(
      fakeQueue({ ensureQueue, enqueue }),
    );

    await service.enqueueChatReindex('chat-1', 'owner-1');

    expect(ensureQueue).toHaveBeenCalledWith(SEARCH_REINDEX_QUEUE);
    expect(enqueue).toHaveBeenCalledWith(
      SEARCH_REINDEX_QUEUE,
      { chatId: 'chat-1', ownerUserId: 'owner-1' },
      { singletonKey: 'chat-1' },
    );
  });

  it('swallows a failed enqueue and logs the chat id', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const ensureQueue = vi.fn().mockResolvedValue(undefined);
    const enqueue = vi.fn().mockRejectedValue(new Error('queue down'));
    const service = new SearchReindexDispatchService(
      fakeQueue({ ensureQueue, enqueue }),
    );

    await expect(
      service.enqueueChatReindex('chat-1', 'owner-1'),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('chat-1');
    expect(warnSpy.mock.calls[0]?.[0]).toContain('discovery sweep');
  });

  it('swallows ensureQueue failure and retries provisioning on the next call', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const ensureQueue = vi
      .fn()
      .mockRejectedValueOnce(new Error('boot failed'))
      .mockResolvedValue(undefined);
    const enqueue = vi.fn().mockResolvedValue('job-id');
    const service = new SearchReindexDispatchService(
      fakeQueue({ ensureQueue, enqueue }),
    );

    await service.enqueueChatReindex('chat-1', 'owner-1');
    await service.enqueueChatReindex('chat-2', 'owner-2');

    expect(ensureQueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('shares one queue-provisioning promise across concurrent enqueue calls', async () => {
    let releaseEnsureQueue: (() => void) | undefined;
    const ensureQueue = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseEnsureQueue = resolve;
        }),
    );
    const enqueue = vi.fn().mockResolvedValue('job-id');
    const service = new SearchReindexDispatchService(
      fakeQueue({ ensureQueue, enqueue }),
    );

    const first = service.enqueueChatReindex('chat-1', 'owner-1');
    const second = service.enqueueChatReindex('chat-2', 'owner-2');
    expect(ensureQueue).toHaveBeenCalledTimes(1);

    releaseEnsureQueue?.();
    await Promise.all([first, second]);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });
});
