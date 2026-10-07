import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { InstanceConfigError } from '@workspace/config-interpolation';

import { loadInstanceConfig as loadInstanceConfigFromPath } from './config-loader';

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    throw new Error(`expected an Error instance, got ${String(error)}`);
  }
  return error.message;
}

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

describe('loadInstanceConfig — webSearch', () => {
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

  it('rejects an unknown chain id', () => {
    writeConfig(
      JSON.stringify({
        webSearch: { engines: [brave()], chain: ['missing'] },
      }),
    );

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

    let message = '';
    try {
      loadInstanceConfig({ BRAVE_API_KEY: sentinel });
    } catch (error) {
      message = errorMessage(error);
    }
    expect(message).toContain('webSearch.chain');
    expect(message).not.toContain(sentinel);
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

  it('reports loader failures as instance configuration errors', () => {
    writeConfig(
      JSON.stringify({
        webSearch: { engines: [brave()], chain: ['missing'] },
      }),
    );

    try {
      loadInstanceConfig();
    } catch (error) {
      expect(error).toBeInstanceOf(InstanceConfigError);
      return;
    }
    throw new Error('expected an InstanceConfigError');
  });
});
