/**
 * SearchEmbedDispatchService unit tests (chat-search-embeddings, design D5) —
 * pure DI unit test, no queue engine, no database. Mirrors the enqueue
 * contract SearchReindexDispatchService already established: best-effort
 * (never throws), coalesced by singletonKey, and additionally OFF-BY-DEFAULT
 * (spec "the embedding layer is off by default") when no corpus model is
 * configured.
 */
import { Logger } from '@nestjs/common';

import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type Queue } from '../queue/queue';
import { SEARCH_EMBED_QUEUE } from './reindex-queues';
import { SearchEmbedDispatchService } from './search-embed-dispatch.service';

function fakeInstanceConfig(embeddingModelId: string | null) {
  const config = {
    ...BUILT_IN_DEFAULTS,
    search: { chats: { embeddingModelId } },
  };
  return { config } satisfies InstanceConfigReader;
}

/** A full Queue fake — only ensureQueue/enqueue are exercised by this
 *  service, but the DI constructor type is the whole interface. */
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

describe('SearchEmbedDispatchService.enqueueChatEmbed', () => {
  it('is off-by-default: no ensureQueue, no send, when no corpus model is configured', async () => {
    const ensureQueue = vi.fn().mockResolvedValue(undefined);
    const enqueue = vi.fn().mockResolvedValue('job-id');
    const service = new SearchEmbedDispatchService(
      fakeQueue({ ensureQueue, enqueue }),
      fakeInstanceConfig(null),
    );

    await service.enqueueChatEmbed('c1', 'u1');

    expect(ensureQueue).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enqueues with the coalescing singletonKey when a corpus model is configured', async () => {
    const ensureQueue = vi.fn().mockResolvedValue(undefined);
    const enqueue = vi.fn().mockResolvedValue('job-id');
    const service = new SearchEmbedDispatchService(
      fakeQueue({ ensureQueue, enqueue }),
      fakeInstanceConfig('model-a'),
    );

    await service.enqueueChatEmbed('c1', 'u1');

    expect(ensureQueue).toHaveBeenCalledWith(SEARCH_EMBED_QUEUE);
    expect(enqueue).toHaveBeenCalledWith(
      SEARCH_EMBED_QUEUE,
      { chatId: 'c1', ownerUserId: 'u1' },
      { singletonKey: 'c1' },
    );
  });

  it('is best-effort: a failed enqueue is swallowed (logged), never thrown', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const ensureQueue = vi.fn().mockResolvedValue(undefined);
    const enqueue = vi.fn().mockRejectedValue(new Error('queue down'));
    const service = new SearchEmbedDispatchService(
      fakeQueue({ ensureQueue, enqueue }),
      fakeInstanceConfig('model-a'),
    );

    await expect(service.enqueueChatEmbed('c1', 'u1')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('retries ensureQueue on a later call after a prior ensureQueue failure', async () => {
    const ensureQueue = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(undefined);
    const enqueue = vi.fn().mockResolvedValue('job-id');
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const service = new SearchEmbedDispatchService(
      fakeQueue({ ensureQueue, enqueue }),
      fakeInstanceConfig('model-a'),
    );

    await service.enqueueChatEmbed('c1', 'u1');
    await service.enqueueChatEmbed('c1', 'u1');

    expect(ensureQueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

/**
 * enqueueChatEmbedStrict (chat-search-embeddings/operations, layer 7, review
 * finding) — the opposite contract from enqueueChatEmbed above, for the ONE
 * caller (`backfill`) that must know whether its enqueues actually happened.
 */
describe('SearchEmbedDispatchService.enqueueChatEmbedStrict', () => {
  it('enqueues with the coalescing singletonKey, same shape as the best-effort method', async () => {
    const ensureQueue = vi.fn().mockResolvedValue(undefined);
    const enqueue = vi.fn().mockResolvedValue('job-id');
    const service = new SearchEmbedDispatchService(
      fakeQueue({ ensureQueue, enqueue }),
      fakeInstanceConfig('model-a'),
    );

    await service.enqueueChatEmbedStrict('c1', 'u1');

    expect(ensureQueue).toHaveBeenCalledWith(SEARCH_EMBED_QUEUE);
    expect(enqueue).toHaveBeenCalledWith(
      SEARCH_EMBED_QUEUE,
      { chatId: 'c1', ownerUserId: 'u1' },
      { singletonKey: 'c1' },
    );
  });

  it('propagates a failed enqueue instead of swallowing it — the whole point of the strict variant', async () => {
    const ensureQueue = vi.fn().mockResolvedValue(undefined);
    const enqueue = vi.fn().mockRejectedValue(new Error('queue down'));
    const service = new SearchEmbedDispatchService(
      fakeQueue({ ensureQueue, enqueue }),
      fakeInstanceConfig('model-a'),
    );

    await expect(service.enqueueChatEmbedStrict('c1', 'u1')).rejects.toThrow(
      'queue down',
    );
  });

  it('propagates a failed ensureQueue instead of swallowing it', async () => {
    const ensureQueue = vi.fn().mockRejectedValue(new Error('boot failed'));
    const enqueue = vi.fn().mockResolvedValue('job-id');
    const service = new SearchEmbedDispatchService(
      fakeQueue({ ensureQueue, enqueue }),
      fakeInstanceConfig('model-a'),
    );

    await expect(service.enqueueChatEmbedStrict('c1', 'u1')).rejects.toThrow(
      'boot failed',
    );
    expect(enqueue).not.toHaveBeenCalled();
  });
});
