import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveEvalEmbedBackend } from './resolve-eval-backend';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'llame-eval-provider-'));
  vi.stubEnv('LLAME_CONFIG_PATH', path.join(directory, 'llame.config.json'));
  vi.stubEnv('EVAL_PROVIDER_KEY', 'evaluation-provider-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it('embeds through the shared OpenRouter account instead of the OpenAI default', async () => {
  writeFileSync(
    path.join(directory, 'llame.config.json'),
    JSON.stringify({
      providers: [
        {
          id: 'account',
          type: 'openrouter',
          key: '{env:EVAL_PROVIDER_KEY}',
          headers: { 'X-Tenant': 'tenant' },
        },
      ],
      embeddingModels: [
        {
          id: 'embed',
          provider: 'account',
          providerModelId: 'openai/text-embedding-3-small',
          dimensions: 2,
        },
      ],
      search: { chats: { embeddingModelId: 'embed' } },
    }),
  );
  const calls: Array<{ url: string; headers: Headers }> = [];
  vi.stubGlobal('fetch', (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: new Request(url).url,
      headers: new Headers(init?.headers),
    });

    return Promise.resolve(
      Response.json({
        data: [{ index: 0, embedding: [0.25, 0.75] }],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      }),
    );
  });
  const resolved = resolveEvalEmbedBackend();
  expect(await resolved?.backend.embedQuery('query')).toEqual([0.25, 0.75]);
  expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/embeddings');
  expect(calls[0]?.headers.get('authorization')).toBe(
    'Bearer evaluation-provider-key',
  );
  expect(calls[0]?.headers.get('x-tenant')).toBe('tenant');
  expect(calls[0]?.headers.has('x-session-id')).toBe(false);
});

it('does not construct a backend when its provider-kind combination is invalid', () => {
  writeFileSync(
    path.join(directory, 'llame.config.json'),
    JSON.stringify({
      providers: [
        { id: 'account', type: 'anthropic', key: '{env:EVAL_PROVIDER_KEY}' },
      ],
      embeddingModels: [
        {
          id: 'embed',
          provider: 'account',
          providerModelId: 'embed',
          dimensions: 2,
        },
      ],
      search: { chats: { embeddingModelId: 'embed' } },
    }),
  );
  expect(resolveEvalEmbedBackend()).toBeUndefined();
});
