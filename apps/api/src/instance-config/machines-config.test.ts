/**
 * `machines` instance-configuration tests (openspec/changes/remote-machines,
 * task 4.1 — "Machines exist only when the operator configures them" and
 * "Machine configuration is validated at startup").
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { InstanceConfigError } from '@workspace/config-interpolation';
import type { UnknownRecord } from '@workspace/runtime-safety';

import { loadInstanceConfig } from './config-loader';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'llame-machines-config-'));
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

describe('machines configuration', () => {
  it('leaves machines undefined when the section is absent', () => {
    writeConfig({});

    expect(load().machines).toBeUndefined();
  });

  it('resolves the ssh file paths to absolute paths and keeps the hosts map', () => {
    writeConfig({
      machines: {
        ssh: {
          knownHostsFile: 'ssh/machine_known_hosts',
          identityFile: '/etc/llame/machine_ed25519',
          configFile: '~/.ssh/config',
        },
        hosts: {
          devl: { destination: 'box' },
          gpu: { destination: 'me@gpu.lan:2222' },
        },
      },
    });

    expect(load().machines).toEqual({
      ssh: {
        knownHostsFile: path.join(cwd, 'ssh/machine_known_hosts'),
        identityFile: '/etc/llame/machine_ed25519',
        configFile: path.join(homedir(), '.ssh/config'),
      },
      hosts: {
        devl: { destination: 'box' },
        gpu: { destination: 'me@gpu.lan:2222' },
      },
    });
  });

  it('resolves a relative known-hosts file against the configuration file directory', () => {
    writeConfig({
      machines: {
        ssh: { knownHostsFile: 'known_hosts' },
        hosts: { devl: { destination: 'box' } },
      },
    });

    expect(load().machines?.ssh.knownHostsFile).toBe(
      path.join(cwd, 'known_hosts'),
    );
  });

  it('leaves an absent identityFile/configFile absent rather than materializing a default', () => {
    writeConfig({
      machines: {
        ssh: { knownHostsFile: '/etc/llame/known_hosts' },
      },
    });

    expect(load().machines).toEqual({
      ssh: { knownHostsFile: '/etc/llame/known_hosts' },
      hosts: {},
    });
  });

  it('does not probe the pinned files while loading', () => {
    writeConfig({
      machines: {
        ssh: { knownHostsFile: path.join(cwd, 'not-mounted') },
      },
    });

    expect(load().machines?.ssh.knownHostsFile).toBe(
      path.join(cwd, 'not-mounted'),
    );
  });

  it("pins host keys against the worker user's ~/.ssh/known_hosts when ssh is omitted", () => {
    writeConfig({
      machines: { hosts: { devl: { destination: 'box' } } },
    });

    expect(load().machines).toEqual({
      ssh: { knownHostsFile: path.join(homedir(), '.ssh', 'known_hosts') },
      hosts: { devl: { destination: 'box' } },
    });
  });

  it('accepts a present but empty section with no Machines', () => {
    writeConfig({ machines: {} });

    expect(load().machines).toEqual({
      ssh: { knownHostsFile: path.join(homedir(), '.ssh', 'known_hosts') },
      hosts: {},
    });
  });

  it('rejects interpolation syntax in a pinned path without printing the resolved value', () => {
    writeConfig({
      machines: {
        ssh: { knownHostsFile: '{env:MACHINE_KNOWN_HOSTS}' },
      },
    });

    const message = loadError({
      MACHINE_KNOWN_HOSTS: '/run/secrets/known_hosts',
    });

    expect(message).toContain('machines.ssh.knownHostsFile');
    expect(message).toContain('literal');
    expect(message).not.toContain('/run/secrets/known_hosts');
  });

  it('rejects a NUL character in a pinned path', () => {
    writeConfig({
      machines: {
        ssh: { knownHostsFile: '/etc/llame/known\u0000hosts' },
      },
    });

    const message = loadError();

    expect(message).toContain('machines.ssh.knownHostsFile');
    expect(message).toContain('NUL');
  });

  it('rejects interpolation syntax in a pinned identity file, naming its key', () => {
    writeConfig({
      machines: {
        ssh: {
          knownHostsFile: '/etc/llame/known_hosts',
          identityFile: '{env:MACHINE_IDENTITY_FILE}',
        },
      },
    });

    const message = loadError({
      MACHINE_IDENTITY_FILE: '/run/secrets/id_ed25519',
    });

    expect(message).toContain('machines.ssh.identityFile');
    expect(message).toContain('literal');
    expect(message).not.toContain('/run/secrets/id_ed25519');
  });

  it('rejects a NUL character in a pinned ssh config file, naming its key', () => {
    writeConfig({
      machines: {
        ssh: {
          knownHostsFile: '/etc/llame/known_hosts',
          configFile: '/etc/llame/ssh\u0000config',
        },
      },
    });

    const message = loadError();

    expect(message).toContain('machines.ssh.configFile');
    expect(message).toContain('NUL');
  });

  it('fails startup naming the offending key for an invalid Machine name', () => {
    writeConfig({
      machines: {
        ssh: { knownHostsFile: '/etc/llame/known_hosts' },
        hosts: { Dev_L: { destination: 'box' } },
      },
    });

    const message = loadError();

    expect(message).toContain('machines.hosts.Dev_L');
    expect(message).toContain('[a-z0-9-]{1,63}');
  });

  it('fails startup naming the destination for an option-shaped destination', () => {
    writeConfig({
      machines: {
        ssh: { knownHostsFile: '/etc/llame/known_hosts' },
        hosts: { devl: { destination: '-oProxyCommand=sh' } },
      },
    });

    const message = loadError();

    expect(message).toContain('machines.hosts.devl.destination');
    expect(message).toContain('must not begin with');
  });

  it('rejects an interpolated destination without printing the resolved value', () => {
    writeConfig({
      machines: {
        ssh: { knownHostsFile: '/etc/llame/known_hosts' },
        hosts: { devl: { destination: '{env:MACHINE_DESTINATION}' } },
      },
    });

    const message = loadError({ MACHINE_DESTINATION: 'box.internal' });

    expect(message).toContain('machines.hosts.devl.destination');
    expect(message).toContain('interpolation');
    expect(message).not.toContain('box.internal');
  });

  it.each([
    ['a percent expansion', 'box%h'],
    ['whitespace', 'box alias'],
    ['a shell metacharacter', 'box;rm -rf /'],
    ['a command substitution', '$(hostname)'],
    ['a path separator', 'box/etc'],
    ['a doubled user delimiter', 'me@@gpu'],
    ['an empty user', '@gpu'],
    ['a non-numeric port', 'gpu:not-a-port'],
  ])('fails startup naming the destination for %s', (_label, destination) => {
    writeConfig({
      machines: {
        ssh: { knownHostsFile: '/etc/llame/known_hosts' },
        hosts: { devl: { destination } },
      },
    });

    expect(loadError()).toContain('machines.hosts.devl.destination');
  });

  it('rejects a destination that is not a string', () => {
    writeConfig({
      machines: {
        ssh: { knownHostsFile: '/etc/llame/known_hosts' },
        hosts: { devl: { destination: 7 } },
      },
    });

    expect(loadError()).toContain('/machines/hosts/devl/destination');
  });

  it('rejects an unknown key inside the machines section', () => {
    writeConfig({
      machines: {
        ssh: { knownHostsFile: '/etc/llame/known_hosts' },
        transports: [],
      },
    });

    expect(loadError()).toContain('/machines/transports: unrecognized key');
  });

  it('rejects an unknown key inside an ssh block', () => {
    writeConfig({
      machines: {
        ssh: { knownHostsFile: '/etc/llame/known_hosts', port: 2222 },
      },
    });

    expect(loadError()).toContain('/machines/ssh/port: unrecognized key');
  });
});

describe('tools.nativeExecutorId cannot impersonate a Machine', () => {
  it('fails startup naming tools.nativeExecutorId for a literal machine: identity', () => {
    writeConfig({ tools: { nativeExecutorId: 'machine:devl' } });

    const message = loadError();

    expect(message).toContain('tools.nativeExecutorId');
    expect(message).toContain('machine:');
  });

  it('fails startup for the prefix in another case', () => {
    writeConfig({ tools: { nativeExecutorId: 'MACHINE:devl' } });

    expect(loadError()).toContain('tools.nativeExecutorId');
  });

  it('fails startup naming tools.nativeExecutorId when an interpolation resolves to a machine: identity', () => {
    writeConfig({ tools: { nativeExecutorId: '{env:EXECUTOR_ID}' } });

    expect(loadError({ EXECUTOR_ID: 'machine:gpu' })).toContain(
      'tools.nativeExecutorId',
    );
  });

  it('accepts an identity that merely contains the prefix later', () => {
    writeConfig({ tools: { nativeExecutorId: 'host-machine:devl' } });

    expect(load().tools.nativeExecutorId).toBe('host-machine:devl');
  });
});

describe('machines configuration errors', () => {
  it('throws InstanceConfigError, never a raw parse error', () => {
    writeConfig({
      machines: {
        ssh: { knownHostsFile: '/etc/llame/known_hosts' },
        hosts: { Dev_L: { destination: 'box' } },
      },
    });

    expect(() => load()).toThrow(InstanceConfigError);
  });
});
