/**
 * `bash` stream spill (tool-result-artifacts D4): a stream that does not fit
 * its inline share is stored as an artifact part, its head and tail stay
 * inline around one omitted-range line, and the artifact notice ends the text.
 * A success, a `command_failed` message, and a `timed_out` message share the
 * shape, and a failed write or a Run that cannot read artifacts keeps the
 * inline result.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';

import { type Db } from '../db/tenant-db.service';
import { type BashKnownResult } from '@workspace/bash-executor';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { createProtocolPeer } from '../testing/machine-protocol-peer';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { MachineConnector } from '../machines/machine-connector.service';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { runTool } from './runner';
import { executeSshBash } from './ssh-bash';
import { type SshClient, type SshRunOutcome } from '../ssh/ssh-client';
import { ArtifactsRepository } from './artifacts/artifacts-repository';
import { artifactDirectory } from './artifacts/host-files';
import { bashTool } from './bash';
import { previewStream, spillBashResult, spillBashStreams } from './bash-spill';
import { renderToolResultText } from './model-text';
import { type MockInstance } from 'vitest';
import { type ToolContext, type ToolResult } from './types';
import { createWorkspaceRootCell } from './workspace-path';

/** The Chat counter every write in this suite takes: seq 5. */
const SEQ = 5;

/** The creation time the mocked insert reports, and each host file's mtime. */
const CREATED_AT = new Date('2026-11-02T12:00:00.000Z');

/** Each test's own `$TMPDIR`, so a host file never reaches the real one. */
let temporaryRoot: string;

/** The host directory of the artifact this suite's writes make. */
function hostDirectory(): string {
  return join(artifactDirectory('chat'), `bash-${SEQ}`);
}

/** The three Chat-scoped calls one artifact write makes. */
type ArtifactWrites = {
  readonly nextSeq: MockInstance<ArtifactsRepository['nextSeq']>;
  readonly insertArtifact: MockInstance<ArtifactsRepository['insertArtifact']>;
  readonly insertParts: MockInstance<ArtifactsRepository['insertParts']>;
};

/** The writes one artifact makes, as their own mocks. */
let insertWrites: ArtifactWrites;

function testContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const db: Db = drizzle.mock();

  return {
    userId: 'owner',
    chatId: 'chat',
    runId: 'run',
    toolCallId: 'call-1',
    nativeExecutorId: 'host',
    nativeDeliverySequence: 1,
    permissionPolicy: compileTestPermissionPolicy(),
    artifactReadable: true,
    tenantDb: {
      runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    },
    ...overrides,
    configuredCredentials: overrides.configuredCredentials ?? [],
  };
}

/** One 100-character line, so 40 fill the head's 4,000 units exactly. */
function logLine(index: number): string {
  return `line ${String(index).padStart(4, '0')} ${'x'.repeat(89)}`;
}

function longLog(lines = 5000): string {
  return Array.from({ length: lines }, (_, index) => logLine(index + 1)).join(
    '\n',
  );
}

function success(stdout: string, overrides: Partial<BashKnownResult> = {}) {
  return {
    status: 'success' as const,
    exitCode: 0,
    stdout,
    stderr: '',
    truncated: false,
    wallTimeMs: 12,
    ...overrides,
  };
}

function textOf(result: ToolResult): string {
  return renderToolResultText('bash', result);
}

beforeEach(() => {
  // A fresh call history per test: the writer mocks below are the same objects
  // across tests, so a call from an earlier test would otherwise be counted.
  vi.clearAllMocks();
  temporaryRoot = mkdtempSync(join(tmpdir(), 'bash-spill-host-'));
  vi.stubEnv('TMPDIR', temporaryRoot);
  insertWrites = {
    nextSeq: vi
      .spyOn(ArtifactsRepository.prototype, 'nextSeq')
      .mockResolvedValue(SEQ),
    insertArtifact: vi
      .spyOn(ArtifactsRepository.prototype, 'insertArtifact')
      .mockResolvedValue({ id: 'artifact-5', createdAt: CREATED_AT }),
    insertParts: vi
      .spyOn(ArtifactsRepository.prototype, 'insertParts')
      .mockResolvedValue(undefined),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(temporaryRoot, { recursive: true, force: true });
});

/** The parts of the one artifact this call wrote. */
function writtenParts() {
  return insertWrites.insertParts.mock.calls[0]?.[1] ?? [];
}

describe('the bash stream preview', () => {
  it('spills 200,000 empty lines with an omitted-range line', async () => {
    const result = await spillBashResult(
      testContext(),
      success('\n'.repeat(200_000)),
    );

    expect(result.status).toBe('success');

    if (result.status !== 'success') return;
    expect(String(result.stdout)).toContain('[lines ');
    expect(result.truncationNotice).toContain(
      'full result: artifact://bash-5/stdout',
    );
  });

  it('keeps a middle omitted when thousands of one-character lines spill', async () => {
    const result = await spillBashStreams(testContext(), {
      stdout: 'a\n'.repeat(9000),
      stderr: '',
    });

    expect(
      result.streams.stdout
        .split('\n')
        .some((line) => /^\[lines \d+-\d+ omitted;/u.test(line)),
    ).toBe(true);
    expect(result.notice).toBeDefined();
  });

  it('keeps a middle omitted for a stream of long short lines', async () => {
    const result = await spillBashStreams(testContext(), {
      stdout: 'ab\n'.repeat(50_000),
      stderr: '',
    });

    expect(
      result.streams.stdout
        .split('\n')
        .some((line) => /^\[lines \d+-\d+ omitted;/u.test(line)),
    ).toBe(true);
  });

  it('keeps a stream of exactly its share inline', async () => {
    const result = await spillBashStreams(testContext(), {
      stdout: 'a'.repeat(16_000),
      stderr: '',
    });

    expect(result.streams.stdout).toBe('a'.repeat(16_000));
    expect(result.artifact).toBeUndefined();
    expect(insertWrites.insertParts).not.toHaveBeenCalled();
  });

  it('divides the budget again when the other stream is small', async () => {
    const result = await spillBashStreams(testContext(), {
      stdout: 'a'.repeat(16_000),
      stderr: 'x',
    });

    expect(result.streams.stderr).toBe('x');
    expect(result.streams.stdout).toContain('[lines ');
  });

  it('cuts the first line and the tail on whole code points', () => {
    const cut = previewStream('a'.repeat(20_000), 16_000);
    expect(cut.head).toEqual(['a'.repeat(4000)]);
    expect(cut.omitted).toEqual({ first: 1, last: 2 });

    const tailCut = previewStream('a'.repeat(20_000), 9);
    expect(tailCut.tail).toHaveLength(1);
    expect(tailCut.tail[0]).toHaveLength(7);
  });

  it('keeps a tail cut on a whole emoji', () => {
    const preview = previewStream('😀'.repeat(10), 9);

    expect([...preview.head, ...preview.tail].join('')).toBe('😀😀😀😀');
  });

  it('keeps the first 40 lines, names lines 41 to 4880, and keeps the last 120', async () => {
    const result = await spillBashResult(testContext(), success(longLog()));

    expect(result.status).toBe('success');

    if (result.status !== 'success') return;
    const lines = String(result.stdout).split('\n');
    expect(lines).toHaveLength(40 + 1 + 120);
    expect(lines.slice(0, 40)).toEqual(
      Array.from({ length: 40 }, (_, index) => logLine(index + 1)),
    );
    expect(lines[40]).toBe(
      '[lines 41-4880 omitted; read artifact://bash-5/stdout:41-4880]',
    );
    expect(lines.slice(41)).toEqual(
      Array.from({ length: 120 }, (_, index) => logLine(4881 + index)),
    );
  });

  it('carries no bound marker when only the inline preview shortened a stream', async () => {
    const result = await spillBashResult(
      testContext(),
      success('a'.repeat(20_000)),
    );

    const text = textOf(result);

    expect(text).not.toContain('[output cut at the bound]');
    expect(text).toContain(
      '[lines 1-2 omitted; read artifact://bash-5/stdout:1-2]',
    );
    expect(text.endsWith(']')).toBe(true);
  });

  it('carries both markers when the executor bound also cut the stream', async () => {
    const result = await spillBashResult(
      testContext(),
      success('a'.repeat(20_000), { truncated: true }),
    );

    const lines = textOf(result).split('\n');

    expect(lines).toContain('[output cut at the bound]');
    expect(lines.at(-1)).toBe(
      '[full result: artifact://bash-5/stdout (3 lines)]',
    );
    expect(lines.indexOf('[output cut at the bound]')).toBeLessThan(
      lines.length - 1,
    );
  });

  it('ends the text with the notice and no host path', async () => {
    const result = await spillBashResult(testContext(), success(longLog()));

    expect(textOf(result).split('\n').at(-1)).toBe(
      '[full result: artifact://bash-5/stdout (5000 lines)]',
    );
  });
});

describe('the bash artifact parts', () => {
  it('spills only the stream that does not fit', async () => {
    await spillBashResult(
      testContext(),
      success('a'.repeat(20_000), { stderr: 'tiny' }),
    );

    expect(insertWrites.insertArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'bash', complete: true }),
    );
    expect(writtenParts()).toEqual([
      expect.objectContaining({
        name: 'stdout',
        contentType: 'text/plain',
        content: Buffer.from('a'.repeat(20_000), 'utf8'),
        byteSize: 20_000,
      }),
    ]);
  });

  it('gives each overflowing stream its own part', async () => {
    const result = await spillBashResult(
      testContext(),
      success('o'.repeat(20_000), { stderr: 'e'.repeat(20_000) }),
    );

    expect(writtenParts().map((part) => part.name)).toEqual([
      'stdout',
      'stderr',
    ]);
    expect(result).toMatchObject({ artifact: 'artifact://bash-5' });
    expect(textOf(result)).toContain(
      '[full result: artifact://bash-5/stdout (3 lines), artifact://bash-5/stderr (3 lines)]',
    );
  });

  it('stores a one-line JSON stream with the JSON content type', async () => {
    const json = JSON.stringify({
      items: Array.from({ length: 4000 }, (_, index) => index),
    });

    await spillBashResult(testContext(), success(json));

    const part = writtenParts()[0];
    expect(part).toMatchObject({
      name: 'stdout',
      contentType: 'application/json',
    });
    expect(part?.content.toString('utf8')).toBe(json);
  });

  it('keeps a failing command’s tail in its message and stores the whole stream', async () => {
    // 400 lines exceed the 16,000-unit inline budget with 40 head and 120 tail
    // lines, and stay small enough that the CI runner renders them quickly.
    const log = longLog(400);

    const result = await spillBashResult(
      testContext(),
      success('', {
        status: 'error',
        exitCode: 1,
        stderr: log,
      }),
    );

    expect(result.status).toBe('error');

    if (result.status !== 'error') return;
    const lines = result.message.split('\n');
    expect(lines[0]).toBe('exit 1, 0.0 s');
    expect(lines).toContain('[stderr]');
    expect(lines).toContain(
      '[lines 41-280 omitted; read artifact://bash-5/stderr:41-280]',
    );
    expect(lines.at(-1)).toBe(
      '[full result: artifact://bash-5/stderr (400 lines)]',
    );
    expect(result.artifact).toBe('artifact://bash-5');
    expect(writtenParts()[0]).toMatchObject({
      name: 'stderr',
      content: Buffer.from(log, 'utf8'),
    });
  });

  it('keeps a timed-out command’s head and tail and stores its stream', async () => {
    const result = await spillBashResult(testContext(), {
      status: 'error',
      type: 'timed_out',
      durationMs: 30_000,
      wallTimeMs: 30_000,
      stdout: longLog(),
      stderr: '',
      truncated: false,
    });

    expect(result.status).toBe('error');

    if (result.status !== 'error') return;
    expect(result.type).toBe('timed_out');
    expect(result.message.split('\n')[0]).toBe('timed out, 30.0 s');
    expect(result.message).toContain(
      '[lines 41-4880 omitted; read artifact://bash-5/stdout:41-4880]',
    );
    expect(result.artifact).toBe('artifact://bash-5');
  });
});

describe('the bash spill boundaries', () => {
  it('gives the whole budget to the one stream that has content', async () => {
    const result = await spillBashStreams(testContext(), {
      stdout: 'a'.repeat(9000),
      stderr: '',
    });

    expect(result.streams.stdout).toBe('a'.repeat(9000));
    expect(result.artifact).toBeUndefined();
  });

  it('marks a direct spill complete when the executor cut nothing', async () => {
    await spillBashStreams(testContext(), {
      stdout: 'a'.repeat(20_000),
      stderr: '',
    });
    expect(insertWrites.insertArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ complete: true }),
    );
  });

  it('names an omitted line whenever a stream spills', async () => {
    const result = await spillBashStreams(testContext(), {
      stdout: `${'a'.repeat(8000)}\n${'a'.repeat(8000)}`,
      stderr: '',
    });

    expect(result.streams.stdout).toContain('[lines ');
    expect(result.artifact).toBe('artifact://bash-5');
  });

  it('keeps no partial line when the head has no budget', () => {
    expect(previewStream('abc', 2)).toEqual({
      head: [],
      tail: ['bc'],
      omitted: { first: 1, last: 1 },
    });
  });

  it('never lets a kept line overrun the head budget', () => {
    const lines = Array.from({ length: 6 }, () => 'b'.repeat(1333));
    const preview = previewStream(lines.join('\n'), 16_000);
    expect(preview.head).toHaveLength(2);
    expect(preview.head.join('').length).toBeLessThanOrEqual(4000);
  });

  it('writes nothing when only the call deadline has expired', async () => {
    await spillBashResult(
      testContext({ timeoutSignal: AbortSignal.abort() }),
      success('a'.repeat(20_000)),
    );
    expect(insertWrites.insertParts).not.toHaveBeenCalled();
  });

  it('writes nothing when the Run is already aborted', async () => {
    const result = await spillBashResult(
      testContext({ abortSignal: AbortSignal.abort() }),
      success('a'.repeat(20_000)),
    );

    expect(insertWrites.insertParts).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('artifact');
  });

  it('drops a write that is still running when the Run aborts', async () => {
    insertWrites.insertParts.mockImplementation(
      () => new Promise<void>(() => {}),
    );
    const controller = new AbortController();

    const pending = spillBashResult(
      testContext({ abortSignal: controller.signal }),
      success('a'.repeat(20_000)),
    );

    setTimeout(() => controller.abort(), 0);
    const result = await pending;
    expect(result).not.toHaveProperty('artifact');
    expect(textOf(result)).toContain('full result not stored');
  });

  it('probes the read group with the bash locator', async () => {
    const result = await spillBashResult(
      testContext({
        permissionPolicy: compileToolPermissionMap(
          { read: { allow: [{ field: 'path', regex: '^artifact://bash-' }] } },
          'policy',
        ),
      }),
      success('a'.repeat(20_000)),
    );

    expect(result).toHaveProperty('artifact', 'artifact://bash-5');
  });
});

describe('the bash spill failure paths', () => {
  it('marks the executor cut on a spilled failure and a timeout', async () => {
    const failure = await spillBashResult(
      testContext(),
      success('', {
        status: 'error',
        exitCode: 1,
        stderr: 'e'.repeat(20_000),
        truncated: true,
      }),
    );

    const timeout = await spillBashResult(testContext(), {
      status: 'error',
      type: 'timed_out',
      durationMs: 30_000,
      wallTimeMs: 30_000,
      stdout: 'o'.repeat(20_000),
      stderr: '',
      truncated: true,
    });

    for (const result of [failure, timeout]) {
      expect(result.status).toBe('error');

      if (result.status !== 'error') return;
      const lines = result.message.split('\n');
      expect(lines).toContain('[output cut at the bound]');
      expect(lines.at(-1)).toMatch(/^\[full result: artifact:\/\/bash-5\//u);
    }
  });

  it('records an artifact the bound cut as incomplete', async () => {
    // The stream is the executor's capture at a 20,000-byte bound.
    await spillBashResult(
      testContext({ artifactMaxBytes: 20_000 }),
      success('a'.repeat(20_000), { truncated: true }),
    );
    expect(insertWrites.insertArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ complete: false }),
    );
  });

  it('records an uncut artifact as complete', async () => {
    await spillBashResult(testContext(), success('a'.repeat(20_000)));
    expect(insertWrites.insertArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ complete: true }),
    );
  });

  it('keeps the inline result when the call has no durable identity', async () => {
    const result = await spillBashResult(
      testContext({ runId: undefined, toolCallId: undefined }),
      success(longLog()),
    );

    expect(insertWrites.insertParts).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('artifact');
    expect(textOf(result)).toContain(
      '[lines 41-4880 omitted; full result not stored]',
    );
  });

  it('keeps the inline result when the artifact write fails', async () => {
    insertWrites.insertParts.mockRejectedValue(
      new Error('the database refused the write'),
    );

    const result = await spillBashResult(
      testContext(),
      success('a'.repeat(20_000)),
    );

    expect(result.status).toBe('success');

    if (result.status !== 'success') return;
    expect(result.artifact).toBeUndefined();
    expect(result.truncationNotice).toBeUndefined();
    expect(textOf(result)).toContain('full result not stored');
    expect(textOf(result)).not.toContain('artifact://');
  });

  it('keeps the head, an un-stored omitted line, and the tail when the write fails', async () => {
    insertWrites.insertParts.mockRejectedValue(
      new Error('the database refused the write'),
    );
    const result = await spillBashResult(testContext(), success(longLog()));

    expect(result.status).toBe('success');

    if (result.status !== 'success') return;
    const lines = String(result.stdout).split('\n');
    expect(lines).toHaveLength(40 + 1 + 120);
    expect(lines[40]).toBe('[lines 41-4880 omitted; full result not stored]');
    expect(lines.slice(41).at(-1)).toBe(logLine(5000));
  });

  it('stores nothing when the Run cannot read artifacts', async () => {
    const result = await spillBashResult(
      testContext({ artifactReadable: false }),
      success(longLog()),
    );

    expect(insertWrites.insertParts).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('artifact');
    expect(textOf(result)).toContain(
      '[lines 41-4880 omitted; full result not stored]',
    );
  });

  it('stores nothing when the read group refuses an artifact locator', async () => {
    const result = await spillBashResult(
      testContext({
        permissionPolicy: compileToolPermissionMap(
          { read: { allow: [{ field: 'path', literal: '/home/u/public' }] } },
          'policy',
        ),
      }),
      success(longLog()),
    );

    expect(insertWrites.insertParts).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('artifact');
  });
});

describe('the bash tool spill on the host and over ssh', () => {
  it('keeps a self-spilled result out of the generic result cap', async () => {
    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
      undefined,
    );
    vi.spyOn(RunEventsRepository.prototype, 'append').mockResolvedValue({
      runId: 'run',
      sequence: 1,
      eventType: 'native.result',
      payload: null,
      createdAt: new Date(),
    });
    vi.stubEnv('BASH_WORKING_DIRECTORY', tmpdir());

    try {
      const result = await runTool(
        bashTool,
        { command: "printf 'a%.0s' {1..20000}" },
        testContext(),
        10,
      );

      expect(result).toMatchObject({ status: 'success' });
      expect(result).not.toHaveProperty('truncated');
      expect(result).toHaveProperty(
        'truncationNotice',
        expect.stringContaining('full result: artifact://bash-5/stdout'),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('spills an ssh:// command whose stderr does not fit', async () => {
    const stderr = 'e'.repeat(20_000);

    const client: SshClient = {
      resolve: () =>
        Promise.resolve({
          outcome: 'resolved',
          destination: { user: 'box', host: 'box', port: 22 },
        }),
      run: (request): Promise<SshRunOutcome> => {
        const nonce =
          /printf '%s:start\\n' '([0-9a-f]+)'/u.exec(
            String(request.input),
          )?.[1] ?? '';

        return Promise.resolve({
          outcome: 'ended',
          stdout: Buffer.from(`${nonce}:start\n`),
          stdoutOverflow: false,
          diagnostic: `${nonce}:start\n${stderr}${nonce}:end:1\n`,
          stderrOverflow: false,
          code: 1,
          signal: null,
        });
      },
      sshConfigText: () => undefined,
      dispose: () => undefined,
    };

    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
      undefined,
    );
    vi.spyOn(RunEventsRepository.prototype, 'append').mockResolvedValue({
      runId: 'run',
      sequence: 1,
      eventType: 'native.result',
      payload: null,
      createdAt: new Date(),
    });

    const result = await executeSshBash(
      {
        ...testContext({ artifactHostFiles: true }),
        sshClient: client,
        sshBinding: {
          destination: 'box',
          user: 'box',
          host: 'box',
          port: 22,
          locator: 'ssh://box@box:22/tmp',
        },
      },
      { command: 'true', cwd: 'ssh://box/tmp' },
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'command_failed',
      artifact: 'artifact://bash-5',
    });

    if (result.status !== 'error') return;
    expect(result.message).toContain(
      '[lines 1-2 omitted; read artifact://bash-5/stderr:1-2]',
    );
    expect(writtenParts()[0]).toMatchObject({
      name: 'stderr',
      content: Buffer.from(stderr, 'utf8'),
    });
    // The ssh:// host cannot open the llame host file; `read` is the route.
    expect(result.message).toContain('[full result: artifact://bash-5/stderr');
    expect(result.message).toContain('; host files on the llame host only]');
  });
});

describe('the Machine bash spill', () => {
  it('keeps a failed Machine command’s tail and stores the whole stderr', async () => {
    const stderr = 'e'.repeat(32_000);

    const peer = createProtocolPeer({
      roots: ['/srv/app'],
      answers: {
        'proc.bash': {
          value: {
            status: 'error',
            exitCode: 1,
            stdout: '',
            stderr,
            truncated: false,
            wallTimeMs: 20,
          },
        },
      },
    });

    const connector = new MachineConnector({
      machines: {
        ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
        hosts: { devl: { destination: 'box' } },
      },
      hubVersion: '9.9.9',
      transportFactory: peer.factory,
      handshakeTimeoutMs: 2000,
    });

    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
      undefined,
    );
    vi.spyOn(RunEventsRepository.prototype, 'append').mockResolvedValue({
      runId: 'run',
      sequence: 1,
      eventType: 'native.result',
      payload: null,
      createdAt: new Date(),
    });

    const result = await bashTool.execute(
      { ...testContext(), machines: connector },
      { command: 'make', cwd: 'machine://devl/srv/app' },
    );

    expect(result.status).toBe('error');

    if (result.status !== 'error') return;
    expect(result.type).toBe('command_failed');
    const lines = result.message.split('\n');
    expect(lines[0]).toBe('exit 1, 0.0 s');
    expect(lines).toContain(
      '[lines 1-3 omitted; read artifact://bash-5/stderr:1-3]',
    );
    expect(result.artifact).toBe('artifact://bash-5');
    expect(writtenParts()[0]).toMatchObject({
      name: 'stderr',
      content: Buffer.from(stderr, 'utf8'),
    });
  });

  it('tells a Machine Workspace that the files are on the llame host only', async () => {
    const peer = createProtocolPeer({
      roots: ['/srv/app'],
      answers: {
        'proc.bash': {
          value: {
            status: 'success',
            exitCode: 0,
            stdout: 'a'.repeat(20_000),
            stderr: '',
            truncated: false,
            wallTimeMs: 10,
          },
        },
      },
    });

    const connector = new MachineConnector({
      machines: {
        ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
        hosts: { devl: { destination: 'box' } },
      },
      hubVersion: '9.9.9',
      transportFactory: peer.factory,
      handshakeTimeoutMs: 2000,
    });

    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
      undefined,
    );
    vi.spyOn(RunEventsRepository.prototype, 'append').mockResolvedValue({
      runId: 'run',
      sequence: 1,
      eventType: 'native.result',
      payload: null,
      createdAt: new Date(),
    });

    const result = await bashTool.execute(
      {
        ...testContext({ artifactHostFiles: true }),
        machines: connector,
        workspaceRoot: createWorkspaceRootCell('machine://devl/srv/app'),
      },
      { command: 'make' },
    );

    expect(result.artifact).toBe('artifact://bash-5');
    expect(textOf(result)).toContain(
      '[full result: artifact://bash-5/stdout (3 lines); host files on the llame host only]',
    );
  });
});

describe('the bash artifact host files', () => {
  it('names the absolute directory of the spilled stream', async () => {
    const result = await spillBashResult(
      testContext({ artifactHostFiles: true }),
      success('a'.repeat(20_000)),
    );

    expect(result.artifact).toBe('artifact://bash-5');
    // Pin the base independently of the production path helper.
    expect(hostDirectory().startsWith(temporaryRoot)).toBe(true);
    expect(textOf(result)).toContain(
      `[full result: artifact://bash-5/stdout (3 lines); host files in ${hostDirectory()}]`,
    );
    expect(readFileSync(join(hostDirectory(), 'stdout.txt'), 'utf8')).toBe(
      'a'.repeat(20_000),
    );
  });

  it('names both parts and the directory when both streams spill', async () => {
    const result = await spillBashResult(
      testContext({ artifactHostFiles: true }),
      success('o'.repeat(20_000), { stderr: 'e'.repeat(20_000) }),
    );

    expect(textOf(result).split('\n').at(-1)).toBe(
      `[full result: artifact://bash-5/stdout (3 lines), artifact://bash-5/stderr (3 lines); host files in ${hostDirectory()}]`,
    );
    expect(readFileSync(join(hostDirectory(), 'stderr.txt'), 'utf8')).toBe(
      'e'.repeat(20_000),
    );
  });

  it('says the files are on the llame host only away from this host', async () => {
    const result = await spillBashResult(
      testContext({ artifactHostFiles: true }),
      success('a'.repeat(20_000)),
      true,
    );

    expect(textOf(result)).toContain(
      '[full result: artifact://bash-5/stdout (3 lines); host files on the llame host only]',
    );
    expect(textOf(result)).not.toContain(tmpdir());
  });

  it('keeps no host path when the Run writes no file', async () => {
    const result = await spillBashResult(
      testContext(),
      success('a'.repeat(20_000)),
    );

    expect(textOf(result).split('\n').at(-1)).toBe(
      '[full result: artifact://bash-5/stdout (3 lines)]',
    );
  });

  it('names the host directory away from this host when only a host bash reads it', async () => {
    const result = await spillBashResult(
      testContext({ artifactReadable: false, artifactHostFiles: true }),
      success('a'.repeat(20_000)),
      true,
    );

    expect(textOf(result)).toContain(
      `[full result: artifact://bash-5/stdout (3 lines); host files in ${hostDirectory()} on the llame host]`,
    );
  });

  it('names the directory for a direct spill with no placement argument', async () => {
    const result = await spillBashStreams(
      testContext({ artifactHostFiles: true }),
      { stdout: 'a'.repeat(20_000), stderr: '' },
    );

    expect(result.notice).toContain(`; host files in ${hostDirectory()}`);
  });

  it('judges the read rule on the allocated locator for the notice', async () => {
    const result = await spillBashResult(
      testContext({
        permissionPolicy: compileToolPermissionMap(
          {
            read: { allow: [{ field: 'path', regex: '^artifact://bash-' }] },
          },
          'policy',
        ),
        artifactHostFiles: true,
      }),
      success('a'.repeat(20_000)),
      true,
    );

    // The read rule admits the artifact, so `read` is the route elsewhere.
    expect(textOf(result)).toContain('; host files on the llame host only]');
  });

  it('stores a host-file artifact when the read rule names the allocated locator', async () => {
    const result = await spillBashResult(
      testContext({
        permissionPolicy: compileToolPermissionMap(
          {
            read: { allow: [{ field: 'path', regex: '^artifact://bash-' }] },
          },
          'policy',
        ),
      }),
      success('a'.repeat(20_000)),
    );

    expect(result.artifact).toBe('artifact://bash-5');
  });

  it('stores through host files when read is only a rejecting group', async () => {
    const result = await spillBashResult(
      testContext({
        artifactReadable: true,
        artifactHostFiles: true,
        permissionPolicy: compileToolPermissionMap(
          {
            read: { allow: [{ field: 'path', regex: '^artifact://bash-' }] },
            bash: { reject: true },
          },
          'policy',
        ),
      }),
      success('a'.repeat(20_000)),
    );

    expect(result.artifact).toBe('artifact://bash-5');
    expect(textOf(result)).toContain(`; host files in ${hostDirectory()}]`);
  });

  it('stores through the shared predicate when read is not admissible', async () => {
    const result = await spillBashResult(
      testContext({
        artifactReadable: false,
        artifactHostFiles: true,
        permissionPolicy: compileToolPermissionMap(
          { bash: { allow: true } },
          'policy',
        ),
      }),
      success('a'.repeat(20_000)),
    );

    expect(result.artifact).toBe('artifact://bash-5');
  });

  it('stores nothing when the host route has no file and read is not a route', async () => {
    writeFileSync(join(tmpdir(), 'llame'), '');

    const result = await spillBashResult(
      testContext({
        artifactReadable: false,
        artifactHostFiles: true,
        permissionPolicy: compileToolPermissionMap(
          { bash: { allow: true } },
          'policy',
        ),
      }),
      success('a'.repeat(20_000)),
    );

    expect(result).not.toHaveProperty('artifact');
    expect(textOf(result)).toContain('full result not stored');
  });

  it('stores an artifact a Run without read opens through host files', async () => {
    const result = await spillBashResult(
      testContext({ artifactReadable: false, artifactHostFiles: true }),
      success('a'.repeat(20_000)),
    );

    expect(result.artifact).toBe('artifact://bash-5');
    expect(readFileSync(join(hostDirectory(), 'stdout.txt'), 'utf8')).toBe(
      'a'.repeat(20_000),
    );
  });

  it('stores nothing when the bash group rejects the call', async () => {
    const result = await spillBashResult(
      testContext({
        artifactReadable: false,
        artifactHostFiles: true,
        permissionPolicy: compileToolPermissionMap(
          { bash: { reject: true } },
          'policy',
        ),
      }),
      success('a'.repeat(20_000)),
    );

    expect(insertWrites.insertParts).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('artifact');
  });
});
