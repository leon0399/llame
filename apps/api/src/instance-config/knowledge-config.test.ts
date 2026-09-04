import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { InstanceConfigError } from '@workspace/config-interpolation';
import { loadInstanceConfig as loadInstanceConfigFromPath } from './config-loader';

describe('knowledge.root instance configuration', () => {
  let cwd: string;
  let previousProfile: string | undefined;

  beforeEach(() => {
    previousProfile = process.env.LLAME_WORKER_PROFILE;
    cwd = mkdtempSync(path.join(tmpdir(), 'llame-knowledge-config-'));
    delete process.env.LLAME_WORKER_PROFILE;
  });

  afterEach(() => {
    if (previousProfile === undefined) delete process.env.LLAME_WORKER_PROFILE;
    else process.env.LLAME_WORKER_PROFILE = previousProfile;
  });

  function loadInstanceConfig(env: NodeJS.ProcessEnv = process.env) {
    return loadInstanceConfigFromPath({
      ...env,
      LLAME_CONFIG_PATH: path.join(cwd, 'llame.config.json'),
    });
  }

  function writeConfig(value: string): void {
    writeFileSync(path.join(cwd, 'llame.config.json'), value);
  }

  it('defaults the optional root to absent', () => {
    expect(loadInstanceConfig().knowledge.root).toBeUndefined();
  });

  it('interpolates the root before requiring an absolute path', () => {
    writeConfig('{ "knowledge": { "root": "{env:KNOWLEDGE_ROOT}" } }');

    expect(
      loadInstanceConfig({ KNOWLEDGE_ROOT: path.join(cwd, 'vault') }).knowledge
        .root,
    ).toBe(path.join(cwd, 'vault'));
  });

  it('rejects a relative interpolated root at the knowledge.root path', () => {
    writeConfig('{ "knowledge": { "root": "{env:KNOWLEDGE_ROOT}" } }');

    expect(() =>
      loadInstanceConfig({ KNOWLEDGE_ROOT: 'relative/vault' }),
    ).toThrow(/knowledge\.root/);
  });

  it.each([
    '{ "knowledge": { "roots": "/tmp/vault" } }',
    '{ "knowledge": { "root": "/tmp/vault", "ownerUserId": "user" } }',
    '{ "knowledge": { "root": { "path": "/tmp/vault" } } }',
  ])('rejects closed-schema knowledge selector shape: %s', (config) => {
    writeConfig(config);

    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });

  it('does not probe a missing root while loading an HTTP-only profile', () => {
    process.env.LLAME_WORKER_PROFILE = 'web';
    const missingRoot = path.join(cwd, 'not-mounted');
    writeConfig(`{ "knowledge": { "root": ${JSON.stringify(missingRoot)} } }`);

    expect(loadInstanceConfig().knowledge.root).toBe(missingRoot);
  });
});
