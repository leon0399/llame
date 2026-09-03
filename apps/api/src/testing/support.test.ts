import type { ModelMessage } from 'ai';

import { TITLE_SYSTEM_PROMPT } from '../titles/title';
import { FakeStreamingModelClient } from './support';

const messages = [
  { role: 'user', content: 'Generate a title' },
] satisfies Array<ModelMessage>;

describe('FakeStreamingModelClient', () => {
  it('aborts a pending title response through the real AI SDK stream', async () => {
    const client = new FakeStreamingModelClient();
    client.titleResponse = new Promise<string>(() => undefined);
    const abort = new AbortController();
    const title = client.streamText({
      messages,
      system: TITLE_SYSTEM_PROMPT,
      abortSignal: abort.signal,
    }).text;

    abort.abort('title-timeout');

    await expect(title).rejects.toBe('title-timeout');
  });
});
