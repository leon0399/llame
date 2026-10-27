import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { InstanceConfigError } from '@workspace/config-interpolation';

import { loadInstanceConfig as loadInstanceConfigFromPath } from './config-loader';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'llame-web-search-config-'));
});

function writeConfig(content: string): void {
  writeFileSync(path.join(tmpDir, 'llame.config.json'), content);
}

function loadInstanceConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadInstanceConfigFromPath({
    ...process.env,
    ...overrides,
    LLAME_CONFIG_PATH: path.join(tmpDir, 'llame.config.json'),
  });
}

function brave(id = 'brave', key = 'brave-secret') {
  return { id, type: 'brave', key };
}

function searxng(id = 'searxng', baseUrl = 'https://search.example.test') {
  return { id, type: 'searxng', baseUrl };
}
function aggregate(id = 'aggregate', engines = ['brave', 'duckduckgo']) {
  return { id, type: 'aggregate', engines };
}
function hostedModel(
  providerType:
    | 'openai-responses'
    | 'openai-completions'
    | 'openai-codex'
    | 'anthropic-messages',
) {
  const provider = {
    id: 'hosted-provider',
    type: providerType,
    ...(providerType === 'openai-completions' && {
      baseUrl: 'https://provider.example.test/v1',
    }),
    ...(providerType === 'openai-codex' && {
      key: 'codex-key',
      accountId: 'codex-account',
    }),
  };
  return {
    providers: [provider],
    models: [
      {
        id: 'hosted-model',
        provider: 'hosted-provider',
        providerModelId: 'hosted-model',
        contextWindowTokens: 1000,
      },
    ],
  };
}

const SEARXNG_BASE_URL_ERROR =
  'webSearch.engines[searxng].baseUrl: must be an absolute http or https URL without userinfo, query, or fragment';

describe('loadInstanceConfig — webSearch', () => {
  it('omits webSearch when it is unconfigured', () => {
    writeConfig('{}');

    const config = loadInstanceConfig();
    expect(Object.hasOwn(config, 'webSearch')).toBe(false);
  });

  it('rejects an empty resolved timeout and names its config path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ ...brave(), timeoutSeconds: '{env:WEB_SEARCH_TIMEOUT}' }],
          chain: ['brave'],
        },
      }),
    );

    expect(() => loadInstanceConfig({ WEB_SEARCH_TIMEOUT: '' })).toThrow(
      'webSearch.engines[brave].timeoutSeconds: resolved to an empty value, which is not a valid number',
    );
  });

  it('rejects an empty resolved key and names its config path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ ...brave(), key: '{env:WEB_SEARCH_KEY}' }],
          chain: ['brave'],
        },
      }),
    );

    expect(() => loadInstanceConfig({ WEB_SEARCH_KEY: '' })).toThrow(
      'webSearch.engines[brave].key: must resolve to a nonblank string',
    );
  });

  it('rejects an empty webSearch chain and names its config path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: { engines: [brave()], chain: [] },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      /webSearch\/chain.*must NOT have fewer than 1 items/u,
    );
  });

  it('loads a minimal Brave engine and defaults its timeout to 60 seconds', () => {
    writeConfig(
      JSON.stringify({
        webSearch: { engines: [brave()], chain: ['brave'] },
      }),
    );

    expect(loadInstanceConfig().webSearch).toEqual({
      engines: [
        {
          id: 'brave',
          type: 'brave',
          key: 'brave-secret',
          timeoutSeconds: 60,
        },
      ],
      chain: ['brave'],
    });
  });

  it('loads an Exa engine and defaults its timeout to 60 seconds', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ id: 'exa', type: 'exa', key: 'exa-secret' }],
          chain: ['exa'],
        },
      }),
    );

    expect(loadInstanceConfig().webSearch).toEqual({
      engines: [
        {
          id: 'exa',
          type: 'exa',
          key: 'exa-secret',
          timeoutSeconds: 60,
        },
      ],
      chain: ['exa'],
    });
  });

  it.each([
    [
      'an interpolated key',
      '{env:EXA_MCP_KEY}',
      { EXA_MCP_KEY: 'exa-secret' },
      'exa-secret',
    ],
    ['no key', undefined, {}, undefined],
    [
      'a blank resolved key',
      '{env:EXA_MCP_KEY}',
      { EXA_MCP_KEY: '' },
      undefined,
    ],
  ] as const)(
    'loads an Exa MCP engine with %s',
    (_description, key, environment, expectedKey) => {
      writeConfig(
        JSON.stringify({
          webSearch: {
            engines: [{ id: 'exa-mcp', type: 'exa-mcp', key }],
            chain: ['exa-mcp'],
          },
        }),
      );

      expect(loadInstanceConfig(environment).webSearch).toStrictEqual({
        engines: [
          {
            id: 'exa-mcp',
            type: 'exa-mcp',
            key: expectedKey,
            timeoutSeconds: 60,
          },
        ],
        chain: ['exa-mcp'],
      });
    },
  );

  it('loads a keyless DuckDuckGo engine', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ id: 'duckduckgo', type: 'duckduckgo' }],
          chain: ['duckduckgo'],
        },
      }),
    );

    expect(loadInstanceConfig().webSearch).toStrictEqual({
      engines: [{ id: 'duckduckgo', type: 'duckduckgo', timeoutSeconds: 60 }],
      chain: ['duckduckgo'],
    });
  });

  it('rejects a key on a DuckDuckGo engine as an unknown key', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [
            { id: 'duckduckgo', type: 'duckduckgo', key: 'not-allowed' },
          ],
          chain: ['duckduckgo'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(/webSearch\/engines\/0\/key/u);
  });

  it('loads a SearXNG engine with an absolute HTTP base URL', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [searxng('searxng', 'http://localhost:8888')],
          chain: ['searxng'],
        },
      }),
    );

    expect(loadInstanceConfig().webSearch).toEqual({
      engines: [
        {
          id: 'searxng',
          type: 'searxng',
          baseUrl: 'http://localhost:8888',
          timeoutSeconds: 60,
        },
      ],
      chain: ['searxng'],
    });
  });

  it('loads a SearXNG engine with an absolute HTTPS base URL', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [searxng()],
          chain: ['searxng'],
        },
      }),
    );

    expect(loadInstanceConfig().webSearch?.engines[0]).toEqual({
      id: 'searxng',
      type: 'searxng',
      baseUrl: 'https://search.example.test',
      timeoutSeconds: 60,
    });
  });

  it('resolves an interpolated SearXNG base URL', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [searxng('searxng', '{env:SEARXNG_BASE_URL}')],
          chain: ['searxng'],
        },
      }),
    );

    expect(
      loadInstanceConfig({ SEARXNG_BASE_URL: 'http://localhost:8888' })
        .webSearch?.engines[0],
    ).toMatchObject({ type: 'searxng', baseUrl: 'http://localhost:8888' });
  });

  it('rejects a relative SearXNG base URL and names its config path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [searxng('searxng', 'search.local/')],
          chain: ['searxng'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(SEARXNG_BASE_URL_ERROR);
  });

  it('rejects an FTP SearXNG base URL with the baseUrl path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [searxng('searxng', 'ftp://search.example.test')],
          chain: ['searxng'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(SEARXNG_BASE_URL_ERROR);
  });

  it('rejects SearXNG base URL userinfo with the baseUrl path', () => {
    for (const baseUrl of [
      'https://user@search.example.test',
      'https://:pass@search.example.test',
    ]) {
      writeConfig(
        JSON.stringify({
          webSearch: {
            engines: [searxng('searxng', baseUrl)],
            chain: ['searxng'],
          },
        }),
      );

      expect(() => loadInstanceConfig()).toThrow(SEARXNG_BASE_URL_ERROR);
    }
  });

  it('rejects a SearXNG base URL query with the baseUrl path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [searxng('searxng', 'https://search.example.test?x=1')],
          chain: ['searxng'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(SEARXNG_BASE_URL_ERROR);
  });

  it('rejects a SearXNG base URL fragment with the baseUrl path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [searxng('searxng', 'https://search.example.test#results')],
          chain: ['searxng'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(SEARXNG_BASE_URL_ERROR);
  });

  it('rejects an engine id longer than 64 characters and names its path', () => {
    const id = 'x'.repeat(65);
    writeConfig(
      JSON.stringify({
        webSearch: { engines: [brave(id)], chain: [id] },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(/webSearch\/engines\/0\/id/u);
  });

  it('rejects an unknown engine key and names its path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ ...brave(), region: 'us' }],
          chain: ['brave'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(/webSearch\/engines\/0\/region/);
  });

  it('rejects duplicate engine ids', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [brave(), brave()],
          chain: ['brave'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      /webSearch\.engines.*duplicate.*brave/u,
    );
  });

  it('rejects a missing Brave key and names the key path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ id: 'brave', type: 'brave' }],
          chain: ['brave'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(/webSearch.*engines.*key/u);
  });

  it('rejects a missing Perplexity key and names the key path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ id: 'perplexity', type: 'perplexity' }],
          chain: ['perplexity'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(/webSearch.*engines.*key/u);
  });

  it('rejects a key on a SearXNG engine as an unknown key', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ ...searxng(), key: 'not-allowed' }],
          chain: ['searxng'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(/webSearch\/engines\/0\/key/u);
  });

  it('rejects a baseUrl on a Brave engine as an unknown key', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ ...brave(), baseUrl: 'https://search.example.test' }],
          chain: ['brave'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      /webSearch\/engines\/0\/baseUrl/u,
    );
  });
  it('loads an aggregate engine and allows it in the chain', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [
            brave(),
            { id: 'duckduckgo', type: 'duckduckgo' },
            aggregate(),
          ],
          chain: ['aggregate'],
        },
      }),
    );

    expect(loadInstanceConfig().webSearch).toStrictEqual({
      engines: [
        {
          id: 'brave',
          type: 'brave',
          key: 'brave-secret',
          timeoutSeconds: 60,
        },
        {
          id: 'duckduckgo',
          type: 'duckduckgo',
          timeoutSeconds: 60,
        },
        {
          id: 'aggregate',
          type: 'aggregate',
          engines: ['brave', 'duckduckgo'],
        },
      ],
      chain: ['aggregate'],
    });
  });
  it('rejects timeoutSeconds on an aggregate as an unknown key', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [
            brave(),
            { id: 'duckduckgo', type: 'duckduckgo' },
            { ...aggregate(), timeoutSeconds: 15 },
          ],
          chain: ['aggregate'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      /webSearch\/engines\/2\/timeoutSeconds/u,
    );
  });

  it('rejects a single aggregate child and names its engines path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [brave(), { ...aggregate(), engines: ['brave'] }],
          chain: ['aggregate'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      /webSearch\/engines\/1\/engines/u,
    );
  });

  it('rejects duplicate aggregate children and names its engines path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [brave(), { ...aggregate(), engines: ['brave', 'brave'] }],
          chain: ['aggregate'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      /webSearch\/engines\/1\/engines/u,
    );
  });

  it('rejects an unknown aggregate child and names its engines path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [brave(), { ...aggregate(), engines: ['brave', 'missing'] }],
          chain: ['aggregate'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      /webSearch\.engines\[aggregate\]\.engines.*missing/u,
    );
  });

  it('rejects a nested aggregate and names its engines path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [
            brave(),
            { id: 'duckduckgo', type: 'duckduckgo' },
            aggregate('nested'),
            { ...aggregate(), engines: ['nested', 'brave'] },
          ],
          chain: ['aggregate'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      /webSearch\.engines\[aggregate\]\.engines.*nested/u,
    );
  });
  it.each([
    ['openai-responses', 'openai-responses'],
    ['openai-codex', 'openai-codex'],
    ['anthropic-messages', 'anthropic-messages'],
  ] as const)(
    'loads model-hosted engines on the %s wire',
    (providerType, wire) => {
      writeConfig(
        JSON.stringify({
          ...hostedModel(providerType),
          webSearch: {
            engines: [
              { id: 'hosted', type: 'model-hosted', model: 'hosted-model' },
            ],
            chain: ['hosted'],
          },
        }),
      );

      expect(loadInstanceConfig().webSearch).toStrictEqual({
        engines: [
          {
            id: 'hosted',
            type: 'model-hosted',
            model: 'hosted-model',
            wire,
            timeoutSeconds: 60,
          },
        ],
        chain: ['hosted'],
      });
    },
  );

  it('rejects model-hosted engines on an unsupported wire', () => {
    writeConfig(
      JSON.stringify({
        ...hostedModel('openai-completions'),
        webSearch: {
          engines: [
            { id: 'hosted', type: 'model-hosted', model: 'hosted-model' },
          ],
          chain: ['hosted'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      'webSearch.engines[hosted].model: unsupported provider type "openai-completions"',
    );
  });

  it('rejects a model-hosted engine with an unknown model', () => {
    writeConfig(
      JSON.stringify({
        ...hostedModel('openai-responses'),
        webSearch: {
          engines: [
            { id: 'hosted', type: 'model-hosted', model: 'missing-model' },
          ],
          chain: ['hosted'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      'webSearch.engines[hosted].model: unknown model id "missing-model"',
    );
  });

  it('loads a model-hosted child inside an aggregate', () => {
    writeConfig(
      JSON.stringify({
        ...hostedModel('openai-responses'),
        webSearch: {
          engines: [
            brave(),
            { id: 'hosted', type: 'model-hosted', model: 'hosted-model' },
            aggregate('aggregate', ['brave', 'hosted']),
          ],
          chain: ['aggregate'],
        },
      }),
    );

    const config = loadInstanceConfig();
    expect(config.webSearch?.engines).toStrictEqual([
      { id: 'brave', type: 'brave', key: 'brave-secret', timeoutSeconds: 60 },
      {
        id: 'hosted',
        type: 'model-hosted',
        model: 'hosted-model',
        wire: 'openai-responses',
        timeoutSeconds: 60,
      },
      { id: 'aggregate', type: 'aggregate', engines: ['brave', 'hosted'] },
    ]);
  });

  it('rejects a model-hosted child inside an aggregate on an unsupported wire', () => {
    writeConfig(
      JSON.stringify({
        ...hostedModel('openai-completions'),
        webSearch: {
          engines: [
            brave(),
            { id: 'hosted', type: 'model-hosted', model: 'hosted-model' },
            aggregate('aggregate', ['brave', 'hosted']),
          ],
          chain: ['aggregate'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      'webSearch.engines[hosted].model: unsupported provider type "openai-completions"',
    );
  });

  it('rejects an unknown chain id', () => {
    writeConfig(
      JSON.stringify({
        webSearch: { engines: [brave()], chain: ['missing'] },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
    expect(() => loadInstanceConfig()).toThrow(/webSearch\.chain.*missing/u);
  });

  it('rejects an allowlisted web_search without webSearch configuration', () => {
    writeConfig(JSON.stringify({ tools: { allowed: ['web_search'] } }));

    expect(() => loadInstanceConfig()).toThrow(/webSearch\.chain/u);
  });

  it('loads configured webSearch when web_search is not allowlisted', () => {
    writeConfig(
      JSON.stringify({
        webSearch: { engines: [brave()], chain: ['brave'] },
      }),
    );

    const config = loadInstanceConfig();
    expect(config.webSearch?.chain).toEqual(['brave']);
    expect(config.tools.allowed).not.toContain('web_search');
  });

  it('does not disclose an interpolated key in a sibling-field error', () => {
    const sentinel = 'brave-secret-sentinel';
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [brave('brave', '{env:BRAVE_API_KEY}')],
          chain: ['missing'],
        },
      }),
    );

    const load = () => loadInstanceConfig({ BRAVE_API_KEY: sentinel });
    expect(load).toThrow(/webSearch\.chain/u);
    expect(load).not.toThrow(sentinel);
  });

  it('accepts an explicit positive timeoutSeconds', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ ...brave(), timeoutSeconds: 15 }],
          chain: ['brave'],
        },
      }),
    );

    expect(loadInstanceConfig().webSearch?.engines[0]).toMatchObject({
      timeoutSeconds: 15,
    });
  });

  it('loads a DeepSeek engine with an interpolated key', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [
            { id: 'deepseek', type: 'deepseek', key: '{env:DEEPSEEK_API_KEY}' },
          ],
          chain: ['deepseek'],
        },
      }),
    );

    expect(
      loadInstanceConfig({ DEEPSEEK_API_KEY: 'deepseek-secret' }).webSearch,
    ).toStrictEqual({
      engines: [
        {
          id: 'deepseek',
          type: 'deepseek',
          key: 'deepseek-secret',
          timeoutSeconds: 60,
        },
      ],
      chain: ['deepseek'],
    });
  });

  it('rejects a missing DeepSeek key and names the key path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ id: 'deepseek', type: 'deepseek' }],
          chain: ['deepseek'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      /webSearch\/engines\/0.*required property 'key'/u,
    );
  });

  it('defaults a Parallel engine mode to fast', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ id: 'parallel', type: 'parallel', key: 'parallel-key' }],
          chain: ['parallel'],
        },
      }),
    );

    expect(loadInstanceConfig().webSearch).toStrictEqual({
      engines: [
        {
          id: 'parallel',
          type: 'parallel',
          key: 'parallel-key',
          mode: 'fast',
          timeoutSeconds: 60,
        },
      ],
      chain: ['parallel'],
    });
  });

  it('loads a Parallel engine with an explicit mode', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [
            {
              id: 'parallel',
              type: 'parallel',
              key: '{env:PARALLEL_API_KEY}',
              mode: 'advanced',
            },
          ],
          chain: ['parallel'],
        },
      }),
    );

    expect(
      loadInstanceConfig({ PARALLEL_API_KEY: 'parallel-secret' }).webSearch
        ?.engines[0],
    ).toStrictEqual({
      id: 'parallel',
      type: 'parallel',
      key: 'parallel-secret',
      mode: 'advanced',
      timeoutSeconds: 60,
    });
  });

  it('rejects an unknown Parallel mode and names the mode path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [
            {
              id: 'parallel',
              type: 'parallel',
              key: 'parallel-key',
              mode: 'deep',
            },
          ],
          chain: ['parallel'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(/webSearch\/engines\/0\/mode/u);
  });

  it('rejects a missing Parallel key and names the key path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ id: 'parallel', type: 'parallel' }],
          chain: ['parallel'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      /webSearch\/engines\/0.*required property 'key'/u,
    );
  });

  it('loads a keyless Parallel MCP engine', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ id: 'parallel-mcp', type: 'parallel-mcp' }],
          chain: ['parallel-mcp'],
        },
      }),
    );

    expect(loadInstanceConfig().webSearch).toStrictEqual({
      engines: [
        { id: 'parallel-mcp', type: 'parallel-mcp', timeoutSeconds: 60 },
      ],
      chain: ['parallel-mcp'],
    });
  });

  it('rejects a key on a Parallel MCP engine and names the key path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [
            { id: 'parallel-mcp', type: 'parallel-mcp', key: 'not-allowed' },
          ],
          chain: ['parallel-mcp'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(/webSearch\/engines\/0\/key/u);
  });

  it('loads a Yandex engine with an interpolated key and folder id', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [
            {
              id: 'yandex',
              type: 'yandex',
              key: '{env:YANDEX_API_KEY}',
              searchType: 'com',
              folderId: '{env:YANDEX_FOLDER_ID}',
            },
          ],
          chain: ['yandex'],
        },
      }),
    );

    expect(
      loadInstanceConfig({
        YANDEX_API_KEY: 'yandex-secret',
        YANDEX_FOLDER_ID: 'b1g-folder-id',
      }).webSearch,
    ).toStrictEqual({
      engines: [
        {
          id: 'yandex',
          type: 'yandex',
          key: 'yandex-secret',
          searchType: 'com',
          folderId: 'b1g-folder-id',
          timeoutSeconds: 60,
        },
      ],
      chain: ['yandex'],
    });
  });

  it('loads a Yandex engine without a folder id or a blank resolution', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [
            {
              id: 'yandex',
              type: 'yandex',
              key: 'yandex-key',
              searchType: 'ru',
            },
            {
              id: 'yandex-blank',
              type: 'yandex',
              key: 'yandex-key',
              searchType: 'ru',
              folderId: '{env:YANDEX_FOLDER_ID}',
            },
          ],
          chain: ['yandex'],
        },
      }),
    );

    expect(
      loadInstanceConfig({ YANDEX_FOLDER_ID: '' }).webSearch?.engines,
    ).toStrictEqual([
      {
        id: 'yandex',
        type: 'yandex',
        key: 'yandex-key',
        searchType: 'ru',
        folderId: undefined,
        timeoutSeconds: 60,
      },
      {
        id: 'yandex-blank',
        type: 'yandex',
        key: 'yandex-key',
        searchType: 'ru',
        folderId: undefined,
        timeoutSeconds: 60,
      },
    ]);
  });

  it('rejects a Yandex engine without a search type and names the searchType property', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ id: 'yandex', type: 'yandex', key: 'yandex-key' }],
          chain: ['yandex'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      /webSearch\/engines\/0.*required property 'searchType'/u,
    );
  });

  it('rejects an unsupported Yandex search type and names the searchType path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [
            {
              id: 'yandex',
              type: 'yandex',
              key: 'yandex-key',
              searchType: 'en',
            },
          ],
          chain: ['yandex'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      /webSearch\/engines\/0\/searchType/u,
    );
  });

  it('rejects an empty resolved Yandex key and names its config path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [
            {
              id: 'yandex',
              type: 'yandex',
              key: '{env:YANDEX_API_KEY}',
              searchType: 'tr',
            },
          ],
          chain: ['yandex'],
        },
      }),
    );

    expect(() => loadInstanceConfig({ YANDEX_API_KEY: '' })).toThrow(
      'webSearch.engines[yandex].key: must resolve to a nonblank string',
    );
  });

  it('loads an engine description literally', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [
            {
              id: 'yandex',
              type: 'yandex',
              key: 'yandex-secret',
              searchType: 'ru',
              description: 'Russian-language and CIS sources',
            },
          ],
          chain: ['yandex'],
        },
      }),
    );

    expect(loadInstanceConfig().webSearch?.engines[0]).toMatchObject({
      id: 'yandex',
      description: 'Russian-language and CIS sources',
    });
  });

  it('loads a description on an aggregate', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [
            brave(),
            { id: 'duckduckgo', type: 'duckduckgo' },
            { ...aggregate('broad'), description: 'Broad sweep' },
          ],
          chain: ['broad'],
        },
      }),
    );

    expect(loadInstanceConfig().webSearch?.engines[2]).toMatchObject({
      id: 'broad',
      type: 'aggregate',
      engines: ['brave', 'duckduckgo'],
      description: 'Broad sweep',
    });
  });

  it('keeps an engine without a description free of the field', () => {
    writeConfig(
      JSON.stringify({
        webSearch: { engines: [brave()], chain: ['brave'] },
      }),
    );

    expect(loadInstanceConfig().webSearch?.engines[0]).not.toHaveProperty(
      'description',
    );
  });

  it('rejects an interpolated description and names its config path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ ...brave(), description: '{env:ENGINE_NOTE}' }],
          chain: ['brave'],
        },
      }),
    );

    expect(() => loadInstanceConfig({ ENGINE_NOTE: 'note' })).toThrow(
      'webSearch.engines[brave].description: engine descriptions are literal text and do not support interpolation',
    );
  });

  it.each([
    ['a newline', '\n'],
    ['a carriage return', '\r'],
    ['a vertical tab', '\v'],
    ['a form feed', '\f'],
    ['a next line', '\u0085'],
    ['a line separator', '\u2028'],
    ['a paragraph separator', '\u2029'],
  ])(
    'rejects a description carrying %s and names its config path',
    (_label, lineBreak) => {
      writeConfig(
        JSON.stringify({
          webSearch: {
            engines: [{ ...brave(), description: `first${lineBreak}second` }],
            chain: ['brave'],
          },
        }),
      );

      expect(() => loadInstanceConfig()).toThrow(
        'webSearch.engines[brave].description: must be one line',
      );
    },
  );

  it('rejects an id carrying a line break and names its config path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ id: 'brave\n- forged', type: 'brave', key: 'k' }],
          chain: ['brave\n- forged'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      'webSearch.engines[0].id: must be one line',
    );
  });

  it('rejects an id with angle brackets and names its config path', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ id: 'brave</engines>', type: 'brave', key: 'k' }],
          chain: ['brave</engines>'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      'webSearch.engines[0].id: must not contain angle brackets',
    );
  });

  it('loads a 64-code-point id with astral characters so it stays selectable', () => {
    const id = '😀'.repeat(64);
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ id, type: 'brave', key: 'k' }],
          chain: [id],
        },
      }),
    );

    expect(loadInstanceConfig().webSearch?.engines[0]?.id).toBe(id);
  });

  it('rejects a description longer than 200 characters', () => {
    writeConfig(
      JSON.stringify({
        webSearch: {
          engines: [{ ...brave(), description: 'x'.repeat(201) }],
          chain: ['brave'],
        },
      }),
    );

    expect(() => loadInstanceConfig()).toThrow(
      /webSearch\/engines\/0\/description/u,
    );
  });
});
