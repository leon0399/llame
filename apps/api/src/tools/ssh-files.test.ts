import { type TenantRunner } from '../db/tenant-db.service';
import {
  type SshBinding,
  type SshClient,
  type SshRunOutcome,
  type SshRunRequest,
} from '../ssh/ssh-client';
import { SSH_LOCATOR_HELP } from '../ssh/ssh-locator';
import { SSH_READ_TRANSFER_BYTES } from '../ssh/ssh-script';
import { nativeEditTool, nativeReadTool } from './native-files';
import { executeSshRead } from './ssh-files';
import { type ToolContext } from './types';

const BINDING: SshBinding = {
  destination: 'box',
  user: 'box',
  hostname: 'box',
  port: 22,
  locator: 'ssh://box@box:22/etc/hostname',
};

const tenantDb: TenantRunner = {
  runAs: () => Promise.reject(new Error('a read records no native attempt')),
};

type Remote = {
  readonly client: SshClient;
  readonly runs: Array<SshRunRequest>;
};

/** A client whose answer is built from the nonce the read drew. */
function remote(
  reply: (nonce: string, request: SshRunRequest) => SshRunOutcome,
): Remote {
  const runs: Array<SshRunRequest> = [];
  const client: SshClient = {
    resolve: () =>
      Promise.resolve({
        outcome: 'resolved',
        destination: { user: 'box', host: 'box', port: 22 },
      }),
    run: (request) => {
      runs.push(request);
      const nonce = /h='([^']+)'/u.exec(String(request.input))?.[1] ?? '';
      return Promise.resolve(reply(nonce, request));
    },
    sshConfigText: () => undefined,
    dispose: () => undefined,
  };
  return { client, runs };
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
    // The transfer asks for the bound plus one byte, plus room for the marker
    // and any login-shell output before it.
    expect(runs[0]?.maxStdoutBytes).toBeGreaterThan(SSH_READ_TRANSFER_BYTES);
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
    expect(result.status === 'error' && result.message).toContain('1 MiB');
    expect(result.status === 'error' && result.message).toContain('bash');
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
});

describe('ssh directory reads', () => {
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
});

describe('ssh read dispatch', () => {
  it('answers a bare locator with the fixed message and starts nothing', async () => {
    const remoteClient = remote(fileReply('x'));
    const result = await executeSshRead(context(remoteClient), 'ssh://');

    expect(result).toMatchObject({ status: 'success', path: 'ssh://' });
    expect(result['content']).toBe(SSH_LOCATOR_HELP);
    expect(remoteClient.runs).toHaveLength(0);
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
});
