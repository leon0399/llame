import * as fs from 'node:fs';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  createSshConfigFile,
  defaultSshConfigFile,
  renderSshConfig,
} from './ssh-config';

// The generated file's own cleanup path only runs when a write or a mkdir
// fails, so the write is the one seam a test has to move. Everything else in
// the module keeps its real implementation.
vi.mock('node:fs', { spy: true });

describe('renderSshConfig', () => {
  const base = {
    knownHostsFile: '/etc/llame/machine_known_hosts',
    includeFile: '/home/llame/.ssh/config',
  };

  it('puts the safety block before the include', () => {
    const text = renderSshConfig(base);
    const lines = text.split('\n');
    expect(lines.find((line) => !line.startsWith('#'))).toBe('Host *');
    expect(lines.at(-2)).toBe('Include "/home/llame/.ssh/config"');
    expect(text.indexOf('Host *')).toBeLessThan(text.indexOf('Include'));
  });

  it('sets every hop-level safety option', () => {
    const text = renderSshConfig(base);
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
    expect(renderSshConfig(base)).not.toContain('IdentityFile');
    expect(
      renderSshConfig({
        ...base,
        identityFile: '/etc/llame/machine_ed25519',
      }),
    ).toContain('  IdentityFile "/etc/llame/machine_ed25519"');
  });

  it('quotes and escapes an argument containing spaces or quotes', () => {
    const text = renderSshConfig({
      knownHostsFile: '/srv/llame keys/pinned"x',
      includeFile: '/home/me/my config',
    });
    expect(text).toContain(
      String.raw`UserKnownHostsFile "/srv/llame keys/pinned\"x"`,
    );
    expect(text).toContain('Include "/home/me/my config"');
  });

  it('states that the include supplies routes but not host-key checking', () => {
    const text = renderSshConfig(base);
    expect(text).toContain('# llame SSH');
    expect(text).toContain('it cannot weaken these options');
  });

  it('ends with the include line and one final newline', () => {
    const text = renderSshConfig(base);
    expect(text.endsWith('Include "/home/llame/.ssh/config"\n')).toBe(true);
    expect(text.split('\n').at(-1)).toBe('');
  });
});

describe('defaultSshConfigFile', () => {
  it('names the worker user own configuration', () => {
    expect(defaultSshConfigFile()).toBe(join(homedir(), '.ssh', 'config'));
  });
});

describe('createSshConfigFile', () => {
  it('writes the text 0600 inside a private directory and removes both', () => {
    const file = createSshConfigFile({
      knownHostsFile: '/tmp/pinned',
      includeFile: '/tmp/operator-config',
    });
    try {
      expect(statSync(file.path).mode & 0o777).toBe(0o600);
      expect(
        statSync(file.path.slice(0, file.path.lastIndexOf('/'))).mode & 0o777,
      ).toBe(0o700);
      expect(readFileSync(file.path, 'utf8')).toBe(file.text);
    } finally {
      file.dispose();
    }
    expect(() => statSync(file.path)).toThrow(/ENOENT/u);
  });

  it('gives each call its own directory', () => {
    const first = createSshConfigFile(base());
    const second = createSshConfigFile(base());
    try {
      expect(first.path).not.toBe(second.path);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it('disposes twice: a repeat cleanup is already done', () => {
    const file = createSshConfigFile(base());
    file.dispose();
    expect(() => file.dispose()).not.toThrow();
  });

  it('removes the private directory and rethrows the failure a write hit', () => {
    const written: Array<string> = [];
    vi.mocked(fs.writeFileSync).mockImplementationOnce((path) => {
      written.push(String(path));
      throw new Error('EIO: the private directory is full');
    });
    expect(() => createSshConfigFile(base())).toThrow(
      new Error('EIO: the private directory is full'),
    );
    expect(() => statSync(dirname(only(written)))).toThrow(/ENOENT/u);
  });

  it('rethrows its own failure and cleans up a directory that is already gone', () => {
    const written: Array<string> = [];
    vi.mocked(fs.writeFileSync).mockImplementationOnce((path) => {
      written.push(String(path));
      // A reaper can empty the temp directory between the write and the
      // cleanup; the cleanup must not turn that into its own ENOENT.
      rmSync(dirname(String(path)), { recursive: true, force: true });
      throw new Error('EIO: the private directory was reaped');
    });
    expect(() => createSshConfigFile(base())).toThrow(
      new Error('EIO: the private directory was reaped'),
    );
    expect(written).toHaveLength(1);
  });
});

function base() {
  return { knownHostsFile: '/tmp/pinned', includeFile: '/tmp/operator-config' };
}

/** The one path a write mock saw, with a clear failure instead of a cast. */
function only(written: ReadonlyArray<string>): string {
  const [first] = written;
  if (first === undefined)
    throw new Error('the generated file was never written');
  return first;
}
