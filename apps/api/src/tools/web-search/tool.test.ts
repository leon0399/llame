import { type ToolContext } from '../types';
import { webSearchInputSchema, webSearchTool } from './tool';

describe('web search tool declaration', () => {
  it('rejects an engine argument and defaults limit to ten', () => {
    expect(
      webSearchInputSchema.safeParse({ query: 'llame', engine: 'brave' })
        .success,
    ).toBe(false);
    expect(webSearchInputSchema.parse({ query: 'llame' })).toEqual({
      query: 'llame',
      limit: 10,
    });
  });

  it('uses the stable read-only declaration and fixed unconfigured error', async () => {
    const context: ToolContext = {
      userId: 'user',
      chatId: 'chat',
      tenantDb: {
        runAs: () => Promise.reject(new Error('unused')),
      },
    };

    expect(webSearchTool.id).toBe('web_search');
    expect(webSearchTool.classification).toBe('read_only');
    expect(webSearchTool.timeoutSeconds).toBeUndefined();
    await expect(
      webSearchTool.execute(context, { query: 'llame', limit: 10 }),
    ).resolves.toEqual({
      status: 'error',
      type: 'web_search_failed',
      message: 'Web search is not configured.',
    });
  });
});
