import { Test } from '@nestjs/testing';
import { vi } from 'vitest';

import { defineQueue, QUEUE, type Queue } from './queue';

vi.hoisted(() => {
  process.env.LLAME_OPENAPI_GENERATION = '1';
});
import { QueueModule } from './queue.module';
delete process.env.LLAME_OPENAPI_GENERATION;

describe('QueueModule OpenAPI provider', () => {
  it('provides a no-op queue while generating OpenAPI', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [QueueModule],
    }).compile();
    const queue = moduleRef.get<Queue>(QUEUE);
    const definition = defineQueue<{ value: string }>({ name: 'test' });

    await expect(queue.ensureQueue(definition)).resolves.toBeUndefined();
    await expect(queue.enqueue(definition, { value: 'x' })).resolves.toBeNull();
    await expect(
      queue.consume(definition, () => Promise.resolve()),
    ).resolves.toBe('openapi-noop');
    await expect(
      queue.schedule(definition, '* * * * *'),
    ).resolves.toBeUndefined();
    await expect(queue.unschedule(definition)).resolves.toBeUndefined();
    await expect(queue.cancel(definition, 'job')).resolves.toBeUndefined();

    await moduleRef.close();
  });
});
