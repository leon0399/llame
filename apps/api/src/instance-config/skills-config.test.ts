import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { InstanceConfigError } from '@workspace/config-interpolation';
import { loadInstanceConfig as loadInstanceConfigFromPath } from './config-loader';

describe('skills.directories instance configuration', () => {
  let cwd: string;
  let previousProfile: string | undefined;

  beforeEach(() => {
    previousProfile = process.env.LLAME_WORKER_PROFILE;
    cwd = mkdtempSync(path.join(tmpdir(), 'llame-skills-config-'));
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

  it('defaults the source list to empty', () => {
    expect(loadInstanceConfig().skills.directories).toEqual([]);
  });

  it('keeps configured absolute sources in order', () => {
    writeConfig(
      JSON.stringify({ skills: { directories: ['/opt/skills', '/srv/team'] } }),
    );

    expect(loadInstanceConfig().skills.directories).toEqual([
      '/opt/skills',
      '/srv/team',
    ]);
  });

  it('expands a leading ~/ against the operator process home', () => {
    writeConfig(
      JSON.stringify({ skills: { directories: ['~/.agents/skills'] } }),
    );

    expect(loadInstanceConfig().skills.directories).toEqual([
      path.join(homedir(), '.agents/skills'),
    ]);
  });

  it('resolves a relative source against the configuration file directory', () => {
    writeConfig(JSON.stringify({ skills: { directories: ['skills'] } }));

    expect(loadInstanceConfig().skills.directories).toEqual([
      path.join(cwd, 'skills'),
    ]);
  });

  it('does not probe a configured source while loading', () => {
    const missing = path.join(cwd, 'not-mounted');
    writeConfig(JSON.stringify({ skills: { directories: [missing] } }));

    expect(loadInstanceConfig().skills.directories).toEqual([missing]);
  });

  it.each(['{env:SKILL_ROOT}', '{path:/run/secrets/skill-root}'])(
    'rejects interpolation syntax in a source before resolving it: %s',
    (source) => {
      writeConfig(JSON.stringify({ skills: { directories: [source] } }));

      let message = '';
      try {
        loadInstanceConfig({ SKILL_ROOT: '/resolved/secret/root' });
      } catch (error) {
        if (error instanceof Error) message = error.message;
      }

      expect(message).toContain('skills.directories[0]');
      expect(message).toContain('literal paths');
      expect(message).not.toContain('/resolved/secret/root');
    },
  );

  it.each<[string, unknown]>([
    ['an empty string', { directories: [''] }],
    ['a non-string entry', { directories: [7] }],
    ['a non-array value', { directories: '/opt/skills' }],
    ['an unknown sibling key', { directory: ['/opt/skills'] }],
    [
      'more than the supported number of sources',
      {
        directories: Array.from({ length: 33 }, (_, index) => `/opt/s${index}`),
      },
    ],
  ])('rejects %s', (_label, skills) => {
    writeConfig(JSON.stringify({ skills }));

    expect(() => loadInstanceConfig()).toThrow(InstanceConfigError);
  });

  it('reports the source index and never a resolved secret value', () => {
    writeConfig(
      JSON.stringify({ skills: { directories: ['/opt/skills', '{env:X}'] } }),
    );

    expect(() => loadInstanceConfig({ X: '/resolved/secret/root' })).toThrow(
      /skills\.directories\[1\][^]*literal paths/,
    );
  });
});
