import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { UnknownRecord } from '@workspace/runtime-safety';
import { loadInstanceConfig } from './config-loader';
import { configuredCredentials } from './configured-credentials';
import { toPublicModel } from '../models/model-catalog';
import {
  decisionEndpoint,
  nonChatHeaders,
  providerBaseUrl,
  resolveModelWire,
} from './provider-routing';
import type { ProviderConfig } from './llame-config';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'llame-provider-routing-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function load(raw: UnknownRecord) {
  const filename = path.join(directory, 'llame.config.json');
  writeFileSync(filename, JSON.stringify(raw));

  return loadInstanceConfig({
    LLAME_CONFIG_PATH: filename,
    SHARED_PROVIDER_KEY: 'provider-secret-canary',
  });
}

const chat = {
  id: 'chat',
  provider: 'account',
  providerModelId: 'anthropic/claude-sonnet-4.6',
  contextWindowTokens: 200_000,
};

const account = {
  id: 'account',
  type: 'openrouter',
  key: '{env:SHARED_PROVIDER_KEY}',
};

describe('account-level providers', () => {
  it('binds all four model kinds to one account and protects its credential once', () => {
    const config = load({
      providers: [account],
      models: [chat],
      embeddingModels: [
        {
          id: 'embed',
          provider: 'account',
          providerModelId: 'openai/text-embedding-3-small',
          dimensions: 1536,
        },
      ],
      decisionModels: [
        { id: 'decision', provider: 'account', model: 'typesafe/jev' },
      ],
      rerankModels: [
        { id: 'rerank', provider: 'account', model: 'cohere/rerank-v3.5' },
      ],
    });

    expect(config.models[0]).toMatchObject({
      provider: 'account',
      wire: 'openai-completions',
    });
    expect(config.embeddingModels[0]).toMatchObject({
      provider: 'account',
      wire: 'openai-embeddings',
    });
    expect(config.decisionModels?.[0]).toMatchObject({
      provider: 'account',
      wire: 'system-one',
    });
    expect(config.rerankModels?.[0]).toMatchObject({
      provider: 'account',
      wire: 'cohere-rerank',
    });
    expect(configuredCredentials(config)).toEqual(['provider-secret-canary']);

    for (const model of config.models)
      expect(toPublicModel(model)).not.toHaveProperty('wire');
  });

  it.each([
    ['claude-sonnet-4-6', 'anthropic-messages'],
    ['union-alpha', 'anthropic-messages'],
    ['gpt-5.4', 'openai-responses'],
    ['glm-5.3-flash', 'openai-completions'],
    ['deepseek-v4-flash', 'openai-responses'],
    ['qwen3.6-plus', 'openai-completions'],
    ['qwen3.8-max', 'anthropic-messages'],
    ['qwen3.6-plus-preview', 'anthropic-messages'],
  ])(
    'selects the Go route for %s without another account',
    (providerModelId, wire) => {
      const config = load({
        providers: [{ ...account, type: 'opencode-go' }],
        models: [{ ...chat, providerModelId }],
      });

      expect(config.models[0]).toMatchObject({ wire, billing: 'subscription' });
    },
  );

  it.each(['proxy-gpt-5.4', 'proxy-glm-5', 'proxy-qwen3.6-plus'])(
    'does not infer a family from an interior substring in %s',
    (providerModelId) => {
      expect(() =>
        load({
          providers: [{ ...account, type: 'opencode-go' }],
          models: [{ ...chat, providerModelId }],
        }),
      ).toThrow('models[chat].wire');
    },
  );

  it('keeps Go-only route pins out of Zen while sharing its decision account', () => {
    const config = load({
      providers: [{ ...account, type: 'opencode-zen' }],
      models: [
        { ...chat, id: 'deepseek', providerModelId: 'deepseek-v4-flash' },
        { ...chat, id: 'qwen', providerModelId: 'qwen3.6-plus' },
      ],
      decisionModels: [{ id: 'decision', provider: 'account', model: 'jev' }],
    });

    expect(config.models.map((model) => model.wire)).toEqual([
      'openai-completions',
      'anthropic-messages',
    ]);
    expect(config.decisionModels?.[0]?.wire).toBe('system-one');
    expect(config.providers.map(decisionEndpoint)).toEqual([
      'https://opencode.ai/zen/v1/systemone',
    ]);
  });

  it.each(['opencode-go', 'opencode-zen'])(
    'rejects unsupported embedding placement on %s even with an explicit wire',
    (type) => {
      expect(() =>
        load({
          providers: [{ ...account, type }],
          embeddingModels: [
            {
              id: 'embed',
              provider: 'account',
              providerModelId: 'embed',
              dimensions: 2,
              wire: 'openai-embeddings',
            },
          ],
        }),
      ).toThrow('embeddingModels[embed].wire');
    },
  );

  it('rejects a Go decision override instead of spending a subscription credential on another kind', () => {
    expect(() =>
      load({
        providers: [{ ...account, type: 'opencode-go' }],
        decisionModels: [
          {
            id: 'decision',
            provider: 'account',
            model: 'jev',
            wire: 'system-one',
          },
        ],
      }),
    ).toThrow('decisionModels[0].wire');
  });

  it.each([undefined, '', '   '])(
    'rejects a decision account without a usable key (%s)',
    (key) => {
      expect(() =>
        load({
          providers: [{ ...account, key }],
          decisionModels: [
            { id: 'decision', provider: 'account', model: 'jev' },
          ],
        }),
      ).toThrow('decisionModels[0].wire');
    },
  );

  it('inherits vendor billing while allowing a model-specific billing choice', () => {
    const config = load({
      providers: [{ ...account, billing: 'subscription' }],
      models: [chat, { ...chat, id: 'usage', billing: 'usage' }],
    });

    expect(config.models.map((model) => model.billing)).toEqual([
      'subscription',
      'usage',
    ]);
  });

  it('requires an explicit wire for an unknown Go family', () => {
    const raw = {
      providers: [{ ...account, type: 'opencode-go' }],
      models: [{ ...chat, providerModelId: 'unregistered-family' }],
    };

    expect(() => load(raw)).toThrow('models[chat].wire');

    const config = load({
      ...raw,
      models: [{ ...raw.models[0], wire: 'anthropic-messages' }],
    });

    expect(config.models[0]).toMatchObject({ wire: 'anthropic-messages' });
  });

  it('honors a chat override without moving the provider credential to another endpoint', () => {
    const config = load({
      providers: [{ ...account, baseUrl: 'https://gateway.example/v1' }],
      models: [{ ...chat, wire: 'anthropic-messages' }],
    });

    expect(config.models[0]).toMatchObject({ wire: 'anthropic-messages' });
    expect(config.providers.map(providerBaseUrl)).toEqual([
      'https://gateway.example/v1',
    ]);
  });

  it.each([
    { models: [{ ...chat, wire: 'cohere-rerank' }] },
    {
      embeddingModels: [
        {
          id: 'embed',
          provider: 'account',
          providerModelId: 'embed',
          dimensions: 2,
          wire: 'openai-completions',
        },
      ],
    },
    {
      decisionModels: [
        {
          id: 'decision',
          provider: 'account',
          model: 'jev',
          wire: 'openai-responses',
        },
      ],
    },
    {
      rerankModels: [
        {
          id: 'rerank',
          provider: 'account',
          model: 'rank',
          wire: 'system-one',
        },
      ],
    },
  ])('rejects a wire from another model kind', (catalogue) => {
    expect(() => load({ providers: [account], ...catalogue })).toThrow(
      /(?:models|Models)\[.*\]\.wire/u,
    );
  });

  it('rejects an unsupported provider-kind pair at its model path', () => {
    expect(() =>
      load({
        providers: [{ ...account, type: 'anthropic' }],
        embeddingModels: [
          {
            id: 'embed',
            provider: 'account',
            providerModelId: 'embed',
            dimensions: 2,
          },
        ],
      }),
    ).toThrow('embeddingModels[embed].wire');
  });

  it('rejects a blank explicit endpoint instead of sending the key to the vendor default', () => {
    expect(() =>
      load({ providers: [{ ...account, baseUrl: '{env:UNSET:-}' }] }),
    ).toThrow('providers[account].baseUrl');
  });
});

const router: ProviderConfig = {
  id: 'account',
  type: 'openrouter',
  key: 'key',
  baseUrl: null,
  headers: {},
};

describe('provider route boundaries', () => {
  it('keeps the OpenRouter decision endpoint on the configured gateway', () => {
    expect(decisionEndpoint(router)).toBe(
      'https://openrouter.ai/api/alpha/decisions',
    );
    expect(
      decisionEndpoint({
        ...router,
        baseUrl: 'https://proxy.example/prefix/v1/',
      }),
    ).toBe('https://proxy.example/prefix/alpha/decisions');
    expect(
      decisionEndpoint({ ...router, baseUrl: 'https://proxy.example/prefix' }),
    ).toBe('https://proxy.example/prefix/alpha/decisions');
  });

  it('does not retarget an OpenAI account when its model overrides the wire', () => {
    const provider: ProviderConfig = { ...router, type: 'openai' };
    expect(
      resolveModelWire(
        provider,
        { kind: 'chat', modelId: 'proxy', wire: 'anthropic-messages' },
        'models[proxy]',
      ),
    ).toBe('anthropic-messages');
    expect(providerBaseUrl(provider)).toBe('https://api.openai.com/v1');
  });

  it('does not invent session identifiers for non-chat requests', () => {
    expect(
      nonChatHeaders({
        Authorization: ['Bearer protected'],
        'X-Session-Id': ['', ''],
        Custom: ['before-', '-after'],
        Empty: [''],
      }),
    ).toEqual({ Authorization: ['Bearer protected'] });
  });

  it('cannot use a subscription account on another authentication transport', () => {
    const codex: ProviderConfig = {
      id: 'subscription',
      type: 'openai-codex',
      key: 'key',
      accountId: 'account',
      headers: {},
    };

    expect(() =>
      resolveModelWire(
        codex,
        { kind: 'chat', modelId: 'gpt', wire: 'openai-completions' },
        'models[gpt]',
      ),
    ).toThrow('models[gpt].wire');
    expect(() =>
      resolveModelWire(
        router,
        { kind: 'chat', modelId: 'gpt', wire: 'openai-codex' },
        'models[gpt]',
      ),
    ).toThrow('models[gpt].wire');
  });
});
