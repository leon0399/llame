/**
 * `ssh` instance-configuration tests (openspec/specs/ssh-locator — "ssh
 * locators are available only with an ssh section" and "SSH settings are
 * validated at startup").
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { InstanceConfigError } from '@workspace/config-interpolation';
import type { UnknownRecord } from '@workspace/runtime-safety';

import { loadInstanceConfig } from './config-loader';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'llame-ssh-config-'));
});

function writeConfig(config: UnknownRecord): void {
  writeFileSync(path.join(cwd, 'llame.config.json'), JSON.stringify(config));
}

function load(env: NodeJS.ProcessEnv = {}) {
  return loadInstanceConfig({
    ...env,
    LLAME_CONFIG_PATH: path.join(cwd, 'llame.config.json'),
  });
}

function loadError(env: NodeJS.ProcessEnv = {}): string {
  try {
    load(env);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error.message;
  }
  throw new Error('expected loadInstanceConfig to throw');
}

describe('ssh configuration', () => {
  it('leaves ssh undefined when the section is absent', () => {
    writeConfig({});

    expect(load().ssh).toBeUndefined();
  });

  it("uses the worker user's files for an empty section", () => {
    writeConfig({ ssh: {} });

    expect(load().ssh).toEqual({
      knownHostsFile: path.join(homedir(), '.ssh', 'known_hosts'),
    });
  });

  it('resolves the ssh file paths and leaves absent optional files absent', () => {
    writeConfig({
      ssh: {
        knownHostsFile: 'ssh/known_hosts',
        identityFile: '/etc/llame/id_ed25519',
      },
    });

    expect(load().ssh).toEqual({
      knownHostsFile: path.join(cwd, 'ssh/known_hosts'),
      identityFile: '/etc/llame/id_ed25519',
    });
  });

  it('resolves a configFile written with ~/', () => {
    writeConfig({ ssh: { configFile: '~/.ssh/config' } });

    expect(load().ssh).toEqual({
      knownHostsFile: path.join(homedir(), '.ssh', 'known_hosts'),
      configFile: path.join(homedir(), '.ssh', 'config'),
    });
  });

  it('does not need a machines section', () => {
    writeConfig({ ssh: {} });

    expect(load().machines).toBeUndefined();
    expect(load().ssh).toBeDefined();
  });

  it('rejects interpolation in an ssh path, naming the key without printing the value', () => {
    writeConfig({ ssh: { identityFile: '{env:KEY_PATH}' } });

    const message = loadError({ KEY_PATH: '/run/secrets/id_ed25519' });

    expect(message).toContain('ssh.identityFile');
    expect(message).toContain('literal');
    expect(message).not.toContain('/run/secrets/id_ed25519');
  });

  it('rejects a NUL character in an ssh path, naming the key', () => {
    writeConfig({ ssh: { knownHostsFile: '/etc/llame/known\u0000hosts' } });

    const message = loadError();

    expect(message).toContain('ssh.knownHostsFile');
    expect(message).toContain('NUL');
  });

  it('rejects an unknown key inside the ssh section', () => {
    writeConfig({
      ssh: { knownHostsFile: '/etc/llame/known_hosts', port: 22 },
    });

    expect(loadError()).toContain('/ssh/port: unrecognized key');
  });

  it('throws InstanceConfigError, never a raw parse error', () => {
    writeConfig({ ssh: { identityFile: '{path:/run/secrets/key}' } });

    expect(() => load()).toThrow(InstanceConfigError);
  });

  it('keeps SSH_AUTH_SOCK as written and resolves an agent socket path', () => {
    writeConfig({ ssh: { identityAgent: 'SSH_AUTH_SOCK' } });
    expect(load().ssh?.identityAgent).toBe('SSH_AUTH_SOCK');

    writeConfig({ ssh: { identityAgent: 'run/agent.sock' } });
    expect(load().ssh?.identityAgent).toBe(path.join(cwd, 'run/agent.sock'));
  });

  it('leaves the agent absent by default', () => {
    writeConfig({ ssh: {} });

    expect(load().ssh).not.toHaveProperty('identityAgent');
  });

  it('rejects interpolation in identityAgent, naming the key', () => {
    writeConfig({ ssh: { identityAgent: '{env:SSH_AUTH_SOCK}' } });

    expect(loadError({ SSH_AUTH_SOCK: '/tmp/agent' })).toContain(
      'ssh.identityAgent',
    );
  });

  it('does not accept an agent for Machines', () => {
    writeConfig({
      machines: { ssh: { identityAgent: 'SSH_AUTH_SOCK' }, hosts: {} },
    });

    expect(loadError()).toContain('/machines/ssh/identityAgent');
  });
});
