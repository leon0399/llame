/**
 * `machines` instance-configuration tests (openspec/changes/remote-machines,
 * task 4.1 — "Machines exist only when the operator configures them" and
 * "Machine configuration is validated at startup"; host-as-machine D3 adds
 * `machines.local`/`machines.default` and the boot invariants).
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

    expect(load().machines?.ssh?.knownHostsFile).toBe(
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

    expect(load().machines?.ssh?.knownHostsFile).toBe(
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

    // No entry declares a destination and no ssh block was written, so the
    // section carries no unused SSH settings (host-as-machine D3).
    expect(load().machines).toEqual({ hosts: {} });
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

describe('machines.local and machines.default (host-as-machine D3)', () => {
  it('resolves a literal local and default that name host entries', () => {
    writeConfig({
      machines: {
        local: 'host',
        default: 'host',
        hosts: { host: {}, gpu: { destination: 'me@gpu.lan:2222' } },
      },
    });

    expect(load().machines).toMatchObject({
      local: 'host',
      default: 'host',
      hosts: { host: {}, gpu: { destination: 'me@gpu.lan:2222' } },
    });
  });

  it("accepts a destination-less entry as this process's own Machine", () => {
    writeConfig({
      machines: { local: 'host', default: 'host', hosts: { host: {} } },
    });

    const machines = load().machines;

    expect(machines?.hosts).toEqual({ host: {} });
    expect(machines?.ssh).toBeUndefined();
  });

  it('resolves a whole-value {env:...} token once, at startup', () => {
    writeConfig({
      machines: {
        local: '{env:LLAME_MACHINE}',
        default: '{env:LLAME_MACHINE:-host}',
        hosts: { gpu: {} },
      },
    });

    expect(load({ LLAME_MACHINE: 'gpu' }).machines).toMatchObject({
      local: 'gpu',
      default: 'gpu',
    });
  });

  it.each([
    [
      'local',
      { local: '{env:LLAME_MACHINE}', hosts: { host: {} } },
      'machines.local',
    ],
    [
      'default',
      { default: '{env:LLAME_MACHINE}', hosts: { host: {} } },
      'machines.default',
    ],
  ])(
    'fails startup naming machines.%s for an env value outside the name grammar',
    (_field, machines, configPath) => {
      writeConfig({ machines });

      const message = loadError({ LLAME_MACHINE: 'GPU_1' });

      expect(message).toContain(configPath);
      expect(message).toContain('[a-z0-9-]{1,63}');
    },
  );

  it('fails startup naming machines.local when it names no entry', () => {
    writeConfig({ machines: { local: 'ghost', hosts: { host: {} } } });

    expect(loadError()).toContain(
      'machines.local: "ghost" names no entry in machines.hosts',
    );
  });

  it('fails startup naming machines.default when it names no entry', () => {
    writeConfig({
      machines: { local: 'host', default: 'ghost', hosts: { host: {} } },
    });

    expect(loadError()).toContain(
      'machines.default: "ghost" names no entry in machines.hosts',
    );
  });

  it('fails startup naming machines.default when this process cannot reach it', () => {
    writeConfig({
      machines: {
        local: 'gpu',
        default: 'devl',
        hosts: { gpu: {}, devl: {} },
      },
    });

    const message = loadError();

    expect(message).toContain('machines.default');
    expect(message).toContain('no destination');
  });

  it('fails startup naming machines.default when a native tool is allowlisted and it is absent', () => {
    writeConfig({ tools: { allowed: ['read'] } });

    expect(loadError()).toContain(
      'machines.default: required because tools.allowed lists the native tool "read"',
    );
  });

  it('fails startup for a Knowledge root and read but no machines.default (H4 A)', () => {
    writeConfig({
      knowledge: { root: '/srv/knowledge' },
      tools: { allowed: ['read'] },
    });

    expect(loadError()).toContain('machines.default');
  });

  it('leaves a process with only installation-backed tools and no Machine loadable', () => {
    writeConfig({ tools: { allowed: ['search_conversations'] } });

    expect(load().machines).toBeUndefined();
  });
});

describe('tools.nativeExecutorId is removed in favor of machines.local (host-as-machine D3)', () => {
  it('fails startup naming the field and the machines.hosts entry that replaces it', () => {
    writeConfig({ tools: { nativeExecutorId: 'personal-host-a' } });

    const message = loadError();

    expect(message).toContain('tools.nativeExecutorId');
    expect(message).toContain('"personal-host-a"');
    expect(message).toContain('machines.local');
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
