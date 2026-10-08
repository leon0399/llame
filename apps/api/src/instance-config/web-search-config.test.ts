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

    expect(loadInstanceConfig().webSearch?.engines[0]?.timeoutSeconds).toBe(15);
  });
});
