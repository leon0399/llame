import { DIRECTORY_TRAVERSAL_BUDGET } from '@workspace/native-file-tools';

import { type TenantRunner } from '../db/tenant-db.service';
import {
  type SshBinding,
  type SshClient,
  type SshRunOutcome,
  type SshRunRequest,
} from '../ssh/ssh-client';
import { SSH_LOCATOR_HELP } from '../ssh/ssh-locator';
import {
  SSH_DIRECTORY_TRANSFER_BYTES,
  SSH_READ_MAX_BYTES,
  SSH_READ_NOISE_BYTES,
  SSH_READ_TRANSFER_BYTES,
} from '../ssh/ssh-script';
import { nativeEditTool, nativeReadTool } from './native-files';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { runTool } from './runner';
import { executeSshRead } from './ssh-files';
import { type ToolContext } from './types';

const BINDING: SshBinding = {
  destination: 'box',
  user: 'box',
  host: 'box',
  port: 22,
  locator: 'ssh://box@box:22/etc/hostname',
};

const tenantDb: TenantRunner = {
  runAs: () => Promise.reject(new Error('a read records no native attempt')),
};

type Remote = {
  readonly client: SshClient;
  readonly runs: Array<SshRunRequest>;
  readonly resolutions: Array<unknown>;
};

/** A client whose answer is built from the nonce the read drew. */
function remote(
  reply: (nonce: string, request: SshRunRequest) => SshRunOutcome,
): Remote {
  const runs: Array<SshRunRequest> = [];
  const resolutions: Array<unknown> = [];
  const client: SshClient = {
    resolve: (request) => {
      resolutions.push(request);
      return Promise.resolve({
        outcome: 'resolved',
        destination: { user: 'box', host: 'box', port: 22 },
      });
    },
    run: (request) => {
      runs.push(request);
      const nonce = /h='([^']+)'/u.exec(String(request.input))?.[1] ?? '';
      return Promise.resolve(reply(nonce, request));
    },
    sshConfigText: () => undefined,
    dispose: () => undefined,
  };
  return { client, runs, resolutions };
}

function ended(
  stdout: Buffer | string,
  stderr: string,
  code = 0,
): SshRunOutcome {
  return {
    outcome: 'ended',
    stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
    stdoutOverflow: false,
    diagnostic: stderr,
    stderrOverflow: false,
    code,
    signal: null,
  };
}

/** A file read's streams: the marker, then the content, then the trailer. */
function fileReply(content: Buffer | string) {
  return (nonce: string): SshRunOutcome =>
    ended(
      Buffer.concat([
        Buffer.from(`${nonce}:start:file\n`),
        Buffer.isBuffer(content) ? content : Buffer.from(content),
      ]),
      `${nonce}:start\n${nonce}:end:0\n`,
    );
}

function directoryReply(pairs: string) {
  return (nonce: string): SshRunOutcome =>
    ended(`${nonce}:start:dir\n${pairs}`, `${nonce}:start\n${nonce}:end:0\n`);
}

function context(remoteClient: Remote | undefined): ToolContext {
  return {
    userId: 'owner',
    chatId: 'chat',
    tenantDb,
    ...(remoteClient !== undefined && {
      sshClient: remoteClient.client,
      sshBinding: BINDING,
    }),
  };
}

async function read(path: string, reply: (nonce: string) => SshRunOutcome) {
  const remoteClient = remote((nonce) => reply(nonce));
  const result = await executeSshRead(context(remoteClient), path);
  return { result, runs: remoteClient.runs };
}

describe('ssh read transfer', () => {
  it('returns file content numbered as a local read numbers it', async () => {
    const { result, runs } = await read(
      'ssh://box/etc/hostname',
      fileReply('first\nsecond\n'),
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      path: 'ssh://box/etc/hostname',
      representation: 'text',
    });
    expect(result['content']).toContain('1: first');
    expect(result['content']).toContain('2: second');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      destination: 'box',
      resolved: { user: 'box', host: 'box', port: 22 },
      remoteCommand: ['sh', '-s'],
    });
    // The kind is unknown until the marker, so the bound covers a directory
    // transfer at its largest, plus room for the marker and login-shell output.
    expect(runs[0]?.maxStdoutBytes).toBe(
      SSH_DIRECTORY_TRANSFER_BYTES + SSH_READ_NOISE_BYTES,
    );
    expect(String(runs[0]?.input)).toContain("p='/etc/hostname'");
  });

  it('applies the selector on the hub, with local line numbers', async () => {
    const { result } = await read(
      'ssh://box/etc/os-release:2-3',
      fileReply('one\ntwo\nthree\nfour\n'),
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      requestedRange: { startLine: 2, endLine: 3 },
    });
    expect(result['content']).toContain('2: two');
    expect(result['content']).toContain('3: three');
    expect(result['path']).toBe('ssh://box/etc/os-release');
  });

  it('drops login-shell output before the marker', async () => {
    const { result } = await read('ssh://box/etc/hostname', (nonce) =>
      ended(
        `${nonce}:start:file\nhostname\n`,
        `Welcome to the box\n${nonce}:start\n${nonce}:end:0\n`,
      ),
    );

    expect(result).toMatchObject({ status: 'success', kind: 'file' });
    expect(result['content']).toContain('1: hostname');
    expect(result['content']).not.toContain('Welcome');
  });

  it('refuses an empty file as empty content and allows NUL', async () => {
    const empty = await read('ssh://box/empty', fileReply(''));
    expect(empty.result).toMatchObject({ status: 'success', kind: 'file' });

    const nul = await read(
      'ssh://box/binaryish',
      fileReply(Buffer.from([0x61, 0x00, 0x62])),
    );
    expect(nul.result).toMatchObject({ status: 'success', kind: 'file' });
    expect(nul.result['content']).toContain('1: a\u0000b');
  });

  it('refuses content over the bound as file_too_large', async () => {
    const { result } = await read(
      'ssh://box/big.txt',
      fileReply(Buffer.alloc(SSH_READ_TRANSFER_BYTES, 0x61)),
    );

    expect(result).toMatchObject({ status: 'error', type: 'file_too_large' });
    expect(result.status === 'error' && result.message).toBe(
      'The remote file is larger than the 1 MiB read bound.',
    );
  });

  it('refuses bytes outside UTF-8 as invalid_utf8', async () => {
    const { result } = await read(
      'ssh://box/usr/bin/ls',
      fileReply(Buffer.from([0xc3, 0x28])),
    );

    expect(result).toMatchObject({ status: 'error', type: 'invalid_utf8' });
  });

  it('passes the call signal and deadline to the client', async () => {
    const controller = new AbortController();
    const remoteClient = remote(fileReply('x\n'));
    await executeSshRead(
      {
        ...context(remoteClient),
        abortSignal: controller.signal,
        timeoutMs: 5000,
      },
      'ssh://box/etc/hostname',
    );

    expect(remoteClient.runs[0]?.signal).toBe(controller.signal);
    expect(remoteClient.runs[0]?.deadlineMs).toBe(5000);
  });

  it('carries no signal field when the call has no deadline', async () => {
    const { runs } = await read('ssh://box/etc/hostname', fileReply('x\n'));

    expect(runs[0]).toBeDefined();
    expect('signal' in (runs[0] ?? {})).toBe(false);
  });

  it('accepts a file exactly at the read bound', async () => {
    const { result } = await read(
      'ssh://box/exact.txt',
      fileReply(Buffer.alloc(SSH_READ_MAX_BYTES, 0x61)),
    );

    expect(result).toMatchObject({ status: 'success', kind: 'file' });
  });

  it('keeps a byte order mark as text, as a local read does', async () => {
    const { result } = await read(
      'ssh://box/bom.txt',
      fileReply(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\n')]),
      ),
    );

    expect(result['content']).toBe('1: \ufeffa\n');
  });

  it('resolves an end-relative selector against the transferred lines', async () => {
    const { result } = await read(
      'ssh://box/etc/os-release:4-',
      fileReply('one\ntwo\nthree\nfour\nfive\n'),
    );

    expect(result).toMatchObject({
      status: 'success',
      requestedRange: { startLine: 4, endLine: 5 },
      representation: 'text',
    });
    expect(result['content']).toBe('3: three\n4: four\n5: five\n');
  });

  it('selects several ranges on the hub', async () => {
    const { result } = await read(
      'ssh://box/notes.txt:1-2,7',
      fileReply(
        ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
          .map((line) => `${line}\n`)
          .join(''),
      ),
    );

    expect(result['content']).toContain('1: one');
    expect(result['content']).toContain('2: two');
    expect(result['content']).toContain('7: seven');
    expect(result['content']).not.toContain('4: four');
    expect(result).toMatchObject({
      requestedRanges: [
        { startLine: 1, endLine: 2 },
        { startLine: 7, endLine: 7 },
      ],
    });
  });

  it('renders a markdown outline from the transferred lines', async () => {
    const { result } = await read(
      'ssh://box/README.md:outline',
      fileReply('# Title\n\ntext\n'),
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      representation: 'outline',
    });
    expect(result['content']).toBe('1: # Title\n3: text\n');
  });
});

describe('ssh read refusals', () => {
  it.each([
    ['not_found', 'not_found'],
    ['not_regular_file', 'not_regular_file'],
    ['unreadable', 'executor_unavailable'],
  ])('maps the %s precondition to %s', async (kind, type) => {
    const { result, runs } = await read('ssh://box/x', (nonce) =>
      ended('', `${nonce}:refuse:${kind}\n${nonce}:end:0\n`),
    );

    expect(result).toMatchObject({ status: 'error', type });
    expect(runs).toHaveLength(1);
    if (kind === 'unreadable')
      expect(result.status === 'error' && result.message).toBe(
        'File could not be read.',
      );
  });

  it('reports a start marker without its trailer as a lost session', async () => {
    const { result } = await read('ssh://box/x', (nonce) =>
      ended(`${nonce}:start:file\npartial`, `${nonce}:start\n`),
    );

    expect(result).toMatchObject({ status: 'error', type: 'ssh_unavailable' });
    expect(result.status === 'error' && result.message).toContain(
      'session_lost',
    );
  });

  it('reports a nonzero read status as an unfinished read', async () => {
    const { result } = await read('ssh://box/x', (nonce) =>
      ended(`${nonce}:start:file\npartial`, `${nonce}:end:1\n`),
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
    });
  });

  it('refuses a transfer cut at the stdout bound as an unfinished read', async () => {
    // The marker and the trailer both arrived, so nothing else would notice
    // that the host wrote more than the transfer carried.
    const { result } = await read('ssh://box/x', (nonce) => ({
      ...ended(`${nonce}:start:file\npartial`, `${nonce}:end:0\n`),
      stdoutOverflow: true,
    }));

    expect(result).toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'The remote read did not finish, so the file could not be read.',
    });
  });

  it('classifies a Windows login shell as an unsupported host', async () => {
    const { result } = await read('ssh://box/x', () =>
      ended(
        '',
        "'sh' is not recognized as an internal or external command,\r\noperable program or batch file.",
        1,
      ),
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'ssh_unsupported_host',
    });
    expect(result.status === 'error' && result.message).toContain('POSIX sh');
  });

  it('classifies a forced command as a host that ran no llame script', async () => {
    const { result } = await read('ssh://box/x', () => ended('', '', 0));

    expect(result).toMatchObject({
      status: 'error',
      type: 'ssh_unsupported_host',
    });
    expect(result.status === 'error' && result.message).toContain(
      'ran no llame script',
    );
  });

  it('answers ssh own refusals with their reason', async () => {
    const missing = await read('ssh://box/x', () => ({
      outcome: 'failed',
      reason: 'client_missing',
      diagnostic: 'spawn ssh ENOENT',
    }));
    expect(
      missing.result.status === 'error' && missing.result.message,
    ).toContain('client_missing');

    const hostKey = await read('ssh://box/x', () =>
      ended('', 'Host key verification failed.', 255),
    );
    expect(
      hostKey.result.status === 'error' && hostKey.result.message,
    ).toContain('host_key_mismatch');
  });

  it('reports a cancelled read as cancelled', async () => {
    const { result } = await read('ssh://box/x', () => ({
      outcome: 'failed',
      reason: 'cancelled',
      diagnostic: '',
    }));

    expect(result).toEqual({
      status: 'error',
      type: 'cancelled',
      message: 'Tool "read" was cancelled.',
    });
  });

  it('reports a foreign refusal kind as a lost session', async () => {
    const { result } = await read('ssh://box/x', (nonce) =>
      ended('', `${nonce}:refuse:from_another_revision\n${nonce}:end:0\n`),
    );

    expect(result).toMatchObject({ status: 'error', type: 'ssh_unavailable' });
    expect(result.status === 'error' && result.message).toContain(
      'session_lost',
    );
  });

  it('reports a foreign content marker as a lost session', async () => {
    const { result } = await read('ssh://box/x', (nonce) =>
      ended(`${nonce}:start:tape\nbody\n`, `${nonce}:start\n${nonce}:end:0\n`),
    );

    expect(result).toMatchObject({ status: 'error', type: 'ssh_unavailable' });
    expect(result.status === 'error' && result.message).toContain(
      'session_lost',
    );
  });

  it('rejects a malformed locator with its own message', async () => {
    const remoteClient = remote(fileReply('x'));
    const result = await executeSshRead(context(remoteClient), 'ssh://box');

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_path',
      message:
        'An ssh:// locator needs an absolute path after the destination, like ssh://box/etc/hostname.',
    });
    expect(remoteClient.runs).toHaveLength(0);
  });
});

describe('ssh directory reads', () => {
  it('refuses a directory past the traversal budget, and lists one at it', async () => {
    // The host collects the local budget plus one and stops: reaching it means
    // the directory is one a local listing refuses, so the hub refuses it with
    // the local result rather than showing the entries the glob reached first.
    const over = await read(
      'ssh://box/many',
      directoryReply(
        Array.from(
          { length: DIRECTORY_TRAVERSAL_BUDGET + 1 },
          (_, index) => `f\0f${String(index).padStart(5, '0')}\0`,
        ).join(''),
      ),
    );
    expect(over.result).toMatchObject({
      status: 'error',
      type: 'directory_too_large',
    });
    expect(over.result.status === 'error' && over.result.message).toBe(
      `Directory contains ${String(DIRECTORY_TRAVERSAL_BUDGET + 1)} entries, exceeding the ${String(DIRECTORY_TRAVERSAL_BUDGET)} entry budget.`,
    );

    const at = await read(
      'ssh://box/many',
      directoryReply(
        Array.from(
          { length: DIRECTORY_TRAVERSAL_BUDGET },
          (_, index) => `f\0f${String(index).padStart(5, '0')}\0`,
        ).join(''),
      ),
    );
    expect(at.result).toMatchObject({ status: 'success', kind: 'directory' });
    expect(at.result['truncated']).toBe(true);
  });

  it('reserves room for the more-entries line at the result bound', async () => {
    // One entry per 15 code units, so the 1000-entry listing crosses the
    // 16 000-unit result cap. The bound line's own room is what decides how
    // many entries survive: the renderer must stop short of the cap by the
    // line the caller appends, never truncate that line's last entry.
    const pairs = Array.from(
      { length: 1001 },
      (_, index) => `f\0f${String(index).padStart(9, '0')}\0`,
    ).join('');

    const { result } = await read(
      'ssh://box/srvxxxxxxxx:1-',
      directoryReply(pairs),
    );
    const content = String(result['content']);

    expect(result['truncated']).toBe(true);
    expect(content.endsWith('  … more entries exist\n')).toBe(true);
    expect(content.match(/- f\d+/gu)).toHaveLength(990);
  });

  it('lists one level in the local form, hidden entries included', async () => {
    const { result } = await read(
      'ssh://box/srv',
      directoryReply('d\0sub\0f\0a.txt\0l\0link\0f\0.hidden\0'),
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'directory',
      path: 'ssh://box/srv',
      truncated: false,
    });
    expect(result['content']).toBe(
      'ssh://box/srv\n  - sub/\n  - .hidden\n  - a.txt\n  - link@\n',
    );
  });

  it('shows an empty directory as the local one', async () => {
    const { result } = await read('ssh://box/empty', directoryReply(''));

    expect(result['content']).toBe('ssh://box/empty\n(empty directory)\n');
  });

  it('keeps a newline-bearing name one entry', async () => {
    const { result } = await read(
      'ssh://box/srv',
      directoryReply('f\0two\nlines\0'),
    );

    expect(result['content']).toBe('ssh://box/srv\n  - two\nlines\n');
  });

  it('bounds the list and says there are more entries', async () => {
    const pairs = Array.from(
      { length: 1001 },
      (_, index) => `f\0f${String(index)}\0`,
    ).join('');

    const { result } = await read('ssh://box/many', directoryReply(pairs));

    expect(result['truncated']).toBe(true);
    expect(result['content']).toContain('more entries exist');
    expect(String(result['content']).match(/- f\d+/gu)).toHaveLength(1000);
  });

  it('keeps the local order before it applies the hub bound', async () => {
    // The host sends glob order: every plain name, then the hidden group. A
    // listing that cut before sorting would drop the hidden entry and keep the
    // last plain one, which is not what a local listing of the same directory
    // shows.
    const pairs = [
      ...Array.from(
        { length: 1001 },
        (_, index) => `f\0f${String(index).padStart(4, '0')}\0`,
      ),
      'f\0.aaa\0',
    ].join('');

    const { result } = await read('ssh://box/srv', directoryReply(pairs));
    const content = String(result['content']);

    expect(content).toContain('  - .aaa');
    expect(content).toContain('  - f0000');
    expect(content).not.toContain('  - f0999');
    expect(content.endsWith('  … more entries exist\n')).toBe(true);
  });

  it('refuses a comma list on a directory', async () => {
    const { result } = await read(
      'ssh://box/srv:1-2,4',
      directoryReply('f\0a\0'),
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'invalid_selector',
    });
  });

  it('refuses a comma list still to place on a directory', async () => {
    const { result } = await read(
      'ssh://box/srv:4-5,99-',
      directoryReply('f\0a\0'),
    );

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_selector',
      message:
        'Comma-separated selectors are not supported for directory reads.',
    });
  });

  it('refuses the outline member on a directory', async () => {
    const { result } = await read(
      'ssh://box/srv:outline',
      directoryReply('f\0a\0'),
    );

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_selector',
      message: 'The :outline member is not supported for directory reads.',
    });
  });

  it('refuses the raw member on a directory', async () => {
    const { result } = await read(
      'ssh://box/srv:raw',
      directoryReply('f\0a\0'),
    );

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_selector',
      message: 'The :raw selector is not supported for directory reads.',
    });
  });

  it('pages a listing by the selector window', async () => {
    const { result } = await read(
      'ssh://box/srv:2-3',
      directoryReply('f\0d\0f\0a\0f\0b\0f\0c\0'),
    );

    expect(result).toMatchObject({ status: 'success', truncated: true });
    expect(result['content']).toBe('ssh://box/srv\n  - b\n  - c\n');
    expect(result['nextOffset']).toBe(3);
  });

  it('pages a listing whose end is relative to the entry count', async () => {
    const { result } = await read(
      'ssh://box/srv:2-',
      directoryReply('f\0d\0f\0a\0f\0b\0f\0c\0'),
    );

    expect(result).toMatchObject({ status: 'success', truncated: false });
    expect(result['content']).toBe('ssh://box/srv\n  - b\n  - c\n  - d\n');
  });
});

describe('ssh read dispatch', () => {
  it('answers a bare locator with the fixed message and starts nothing', async () => {
    const remoteClient = remote(fileReply('x'));
    const result = await executeSshRead(context(remoteClient), 'ssh://');

    expect(result).toEqual({
      status: 'success',
      kind: 'file',
      path: 'ssh://',
      representation: 'text',
      content: SSH_LOCATOR_HELP,
      truncated: false,
      requestedRange: null,
      shownRange: null,
    });
    expect(remoteClient.runs).toHaveLength(0);
  });

  it('returns that message through the tool when the section is present', async () => {
    // The scheme exists only with the operator's `ssh` section, so that is the
    // one configuration that answers a bare locator with the fixed message.
    const remoteClient = remote(fileReply('x'));

    for (const path of ['ssh://', 'ssh:///']) {
      const result = await runTool(
        nativeReadTool,
        { path },
        {
          ...context(undefined),
          permissionPolicy: compileToolPermissionMap(
            { read: { allow: true } },
            'test-policy',
          ),
          sshClient: remoteClient.client,
        },
        5,
      );

      expect(result).toMatchObject({ status: 'success', kind: 'file', path });
      expect(result['content']).toBe(SSH_LOCATOR_HELP);
      expect(remoteClient.runs).toHaveLength(0);
      expect(remoteClient.resolutions).toHaveLength(0);
    }
  });

  it('keeps every ssh call an unknown scheme without the section', async () => {
    const shared = {
      ...context(undefined),
      permissionPolicy: compileToolPermissionMap(
        { read: { allow: true }, edit: { allow: true } },
        'test-policy',
      ),
    };
    const unknownScheme = {
      status: 'error',
      type: 'invalid_path',
      message: 'This path scheme is not available.',
    };

    for (const path of ['ssh://', 'ssh:///', 'ssh://box/etc/hostname'])
      expect(await runTool(nativeReadTool, { path }, shared, 5)).toEqual(
        unknownScheme,
      );
    expect(
      await runTool(
        nativeEditTool,
        { path: 'ssh://', oldText: 'a', newText: 'b' },
        shared,
        5,
      ),
    ).toEqual(unknownScheme);
  });

  it('fails closed without a binding and starts nothing', async () => {
    const remoteClient = remote(fileReply('x'));
    const result = await executeSshRead(
      { ...context(undefined), sshClient: remoteClient.client },
      'ssh://box/etc/hostname',
    );

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'This path scheme is not available.',
    });
    expect(remoteClient.runs).toHaveLength(0);
  });

  it('runs an ssh read through the native file dispatch', async () => {
    const remoteClient = remote(fileReply('hostname\n'));
    const result = await nativeReadTool.execute(context(remoteClient), {
      path: 'ssh://box/etc/hostname',
    });

    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      path: 'ssh://box/etc/hostname',
    });
    expect(remoteClient.runs).toHaveLength(1);
  });

  it('keeps a mutation on an ssh locator out of the transport', async () => {
    const remoteClient = remote(fileReply('x'));
    const result = await nativeEditTool.execute(context(remoteClient), {
      path: 'ssh://box/tmp/x.txt',
      oldText: 'a',
      newText: 'b',
    });

    expect(result).toMatchObject({
      status: 'error',
      type: 'unsupported_operation',
    });
    expect(remoteClient.runs).toHaveLength(0);
  });

  it('keeps a non-ssh scheme out of the ssh branch when a client exists', async () => {
    const remoteClient = remote(fileReply('x'));
    const result = await nativeReadTool.execute(context(remoteClient), {
      path: 'media://box/clip.mp4',
    });

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'This path scheme is not available.',
    });
    expect(remoteClient.runs).toHaveLength(0);
  });

  it('keeps an ssh mutation unavailable when no client exists', async () => {
    const result = await nativeEditTool.execute(context(undefined), {
      path: 'ssh://box/tmp/x.txt',
      oldText: 'a',
      newText: 'b',
    });

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'This path scheme is not available.',
    });
  });
});
