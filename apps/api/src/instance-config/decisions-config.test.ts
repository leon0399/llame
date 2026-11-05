import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { InstanceConfigError } from '@workspace/config-interpolation';
import { type UnknownRecord } from '@workspace/runtime-safety';

import { loadInstanceConfig as loadInstanceConfigFromPath } from './config-loader';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'llame-decisions-config-'));
});

function writeConfig(content: UnknownRecord): void {
  writeFileSync(
    path.join(tmpDir, 'llame.config.json'),
    JSON.stringify(content),
  );
}

function loadInstanceConfig() {
  return loadInstanceConfigFromPath({
    ...process.env,
    LLAME_CONFIG_PATH: path.join(tmpDir, 'llame.config.json'),
  });
}

const SYSTEM_ONE_PROVIDER = {
  id: 'opencode-decisions',
  type: 'system-one',
  key: 'oc-test-key',
  baseUrl: 'https://opencode.ai/zen/v1',
};

function configWith(
  decisions: UnknownRecord,
  providers: ReadonlyArray<unknown> = [SYSTEM_ONE_PROVIDER],
): void {
  writeConfig({ providers, decisions });
}

describe('decisions config', () => {
  it('is absent when the block is not configured', () => {
    writeConfig({ providers: [SYSTEM_ONE_PROVIDER] });
    expect(loadInstanceConfig().decisions).toBeUndefined();
  });

  it('resolves the block with both rerank modes defaulting to off', () => {
    configWith({ provider: 'opencode-decisions', model: 'jev-1.13' });

    expect(loadInstanceConfig().decisions).toEqual({
      provider: 'opencode-decisions',
      model: 'jev-1.13',
      rerank: { webSearch: 'off', grep: 'off' },
    });
  });

  it('keeps the configured rerank modes and the fallback price', () => {
    configWith({
      provider: 'opencode-decisions',
      model: '~typesafe/jev-latest',
      pricingUsdPer1M: { input: 0.042 },
      rerank: { webSearch: 'shadow', grep: 'on' },
    });

    expect(loadInstanceConfig().decisions).toEqual({
      provider: 'opencode-decisions',
      model: '~typesafe/jev-latest',
      pricingUsdPer1M: { input: 0.042 },
      rerank: { webSearch: 'shadow', grep: 'on' },
    });
  });

  it('rejects a provider id that does not exist', () => {
    configWith({ provider: 'missing', model: 'jev-1.13' });

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'decisions.provider: unknown provider id "missing"',
      ),
    );
  });

  it('rejects a provider that is not a system-one entry', () => {
    configWith({ provider: 'openai', model: 'jev-1.13' }, [
      {
        id: 'openai',
        type: 'openai-responses',
        key: 'sk-test',
      },
    ]);

    expect(() => loadInstanceConfig()).toThrow(
      new InstanceConfigError(
        'decisions.provider: provider "openai" has type "openai-responses", not "system-one"',
      ),
    );
  });

  it('rejects an unknown rerank mode at the config path', () => {
    configWith({
      provider: 'opencode-decisions',
      model: 'jev-1.13',
      rerank: { webSearch: 'always' },
    });

    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });

  it('requires a system-one provider to carry a key and a baseUrl', () => {
    writeConfig({
      providers: [{ id: 'native', type: 'system-one', key: 'k' }],
    });

    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });

  it('fails startup when the system-one key interpolates to empty', () => {
    writeConfig({
      providers: [
        {
          id: 'native',
          type: 'system-one',
          key: '{env:NOT_SET_DECISIONS_KEY:-}',
          baseUrl: 'https://api.typesafe.ai/v1',
        },
      ],
    });

    expect(() => loadInstanceConfig()).toThrow(
      'providers[native].key: must resolve to a nonblank string',
    );
  });

  it('gives a system-one provider no session header by default', () => {
    writeConfig({ providers: [SYSTEM_ONE_PROVIDER] });

    const provider = loadInstanceConfig().providers[0];
    expect(provider).toMatchObject({
      id: 'opencode-decisions',
      type: 'system-one',
      baseUrl: 'https://opencode.ai/zen/v1',
      headers: {},
    });
  });
});
