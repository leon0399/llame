import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  createMachineSshConfigFile,
  defaultMachineSshConfigFile,
  renderMachineSshConfig,
} from './machine-ssh-config';

describe('renderMachineSshConfig', () => {
  const base = {
    knownHostsFile: '/etc/llame/machine_known_hosts',
    includeFile: '/home/llame/.ssh/config',
  };

  it('puts the safety block before the include', () => {
    const text = renderMachineSshConfig(base);
    const lines = text.split('\n');
    expect(lines[4]).toBe('Host *');
    expect(lines.at(-2)).toBe('Include "/home/llame/.ssh/config"');
    expect(text.indexOf('Host *')).toBeLessThan(text.indexOf('Include'));
  });

  it('sets every hop-level safety option', () => {
    const text = renderMachineSshConfig(base);
    for (const expected of [
      'UserKnownHostsFile "/etc/llame/machine_known_hosts"',
      'GlobalKnownHostsFile none',
      'StrictHostKeyChecking yes',
      'BatchMode yes',
      'IdentityAgent none',
      'ForwardAgent no',
      'ForwardX11 no',
      'ControlMaster no',
      'ControlPath none',
      'PermitLocalCommand no',
      'UpdateHostKeys no',
      'ConnectTimeout 10',
      'ServerAliveInterval 15',
      'ServerAliveCountMax 3',
    ]) {
      expect(text.split('\n')).toContain(`  ${expected}`);
    }
  });

  it('adds the llame identity only when configured', () => {
    expect(renderMachineSshConfig(base)).not.toContain('IdentityFile');
    expect(
      renderMachineSshConfig({ ...base, identityFile: '/etc/llame/machine_ed25519' }),
    ).toContain('  IdentityFile "/etc/llame/machine_ed25519"');
  });

  it('quotes and escapes an argument containing spaces or quotes', () => {
    const text = renderMachineSshConfig({
      knownHostsFile: '/srv/llame keys/pinned"x',
      includeFile: '/home/me/my config',
    });
    expect(text).toContain(String.raw`UserKnownHostsFile "/srv/llame keys/pinned\"x"`);
    expect(text).toContain('Include "/home/me/my config"');
  });

  it('states that the include supplies routes but not host-key checking', () => {
    const text = renderMachineSshConfig(base);
    expect(text).toContain('# llame Machines');
    expect(text).toContain('it cannot weaken these options');
  });
});

describe('defaultMachineSshConfigFile', () => {
  it('names the worker user own configuration', () => {
    expect(defaultMachineSshConfigFile()).toBe(join(homedir(), '.ssh', 'config'));
  });
});

describe('createMachineSshConfigFile', () => {
  it('writes the text 0600 inside a private directory and removes both', () => {
    const file = createMachineSshConfigFile({
      knownHostsFile: '/tmp/pinned',
      includeFile: '/tmp/operator-config',
    });
    try {
      expect(statSync(file.path).mode & 0o777).toBe(0o600);
      expect(statSync(file.path.slice(0, file.path.lastIndexOf('/'))).mode & 0o777).toBe(0o700);
      expect(readFileSync(file.path, 'utf8')).toBe(file.text);
    } finally {
      file.dispose();
    }
    expect(() => statSync(file.path)).toThrow(/ENOENT/u);
  });

  it('gives each call its own directory', () => {
    const first = createMachineSshConfigFile(base());
    const second = createMachineSshConfigFile(base());
    try {
      expect(first.path).not.toBe(second.path);
    } finally {
      first.dispose();
      second.dispose();
    }
  });
});

function base() {
  return { knownHostsFile: '/tmp/pinned', includeFile: '/tmp/operator-config' };
}
