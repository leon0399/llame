/**
 * `bash` stream spill (tool-result-artifacts D4): a stream that does not fit
 * its inline share is stored as an artifact part, its head and tail stay
 * inline around one omitted-range line, and the artifact notice ends the text.
 * A success, a `command_failed` message, and a `timed_out` message share the
 * shape, and a failed write or a Run that cannot read artifacts keeps the
 * inline result.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type BashKnownResult } from '@workspace/bash-executor';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { createProtocolPeer } from '../testing/machine-protocol-peer';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { MachineConnector } from '../machines/machine-connector.service';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { ArtifactsRepository } from './artifacts/artifacts-repository';
import { bashTool } from './bash';
import { spillBashResult } from './bash-spill';
import { renderToolResultText } from './model-text';
import { type MockInstance } from 'vitest';
import { type ToolContext, type ToolResult } from './types';

/** The Chat counter every write in this suite takes: seq 5. */
const SEQ = 5;

/** The three Chat-scoped calls one artifact write makes. */
type ArtifactWrites = {
  readonly nextSeq: MockInstance<ArtifactsRepository['nextSeq']>;
  readonly insertArtifact: MockInstance<ArtifactsRepository['insertArtifact']>;
  readonly insertParts: MockInstance<ArtifactsRepository['insertParts']>;
};

/** The writes one artifact makes, as their own mocks. */
let insertWrites: ArtifactWrites;

function testContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const db: Db = drizzle.mock({ schema });
  return {
    userId: 'owner',
    chatId: 'chat',
    runId: 'run',
    toolCallId: 'call-1',
    permissionPolicy: compileTestPermissionPolicy(),
    artifactReadable: true,
    tenantDb: {
      runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    },
    ...overrides,
  };
}

/** One 100-character line, so 40 fill the head's 4,000 units exactly. */
function logLine(index: number): string {
  return `line ${String(index).padStart(4, '0')} ${'x'.repeat(90)}`;
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
  vi.restoreAllMocks();
  insertWrites = {
    nextSeq: vi
      .spyOn(ArtifactsRepository.prototype, 'nextSeq')
      .mockResolvedValue(SEQ),
    insertArtifact: vi
      .spyOn(ArtifactsRepository.prototype, 'insertArtifact')
      .mockResolvedValue('artifact-5'),
    insertParts: vi
      .spyOn(ArtifactsRepository.prototype, 'insertParts')
      .mockResolvedValue(undefined),
  };
});

/** The parts of the one artifact this call wrote. */
function writtenParts() {
  return insertWrites.insertParts.mock.calls[0]?.[1] ?? [];
}

describe('the bash stream preview', () => {
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
      '[lines 1-1 omitted; read artifact://bash-5/stdout:1-1]',
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
    const result = await spillBashResult(
      testContext(),
      success('', {
        status: 'error',
        exitCode: 1,
        stderr: longLog(),
      }),
    );

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    const lines = result.message.split('\n');
    expect(lines[0]).toBe('exit 1, 0.0 s');
    expect(lines).toContain('[stderr]');
    expect(lines).toContain(
      '[lines 41-4880 omitted; read artifact://bash-5/stderr:41-4880]',
    );
    expect(lines.at(-1)).toBe(
      '[full result: artifact://bash-5/stderr (5000 lines)]',
    );
    expect(result.artifact).toBe('artifact://bash-5');
    expect(writtenParts()[0]).toMatchObject({
      name: 'stderr',
      content: Buffer.from(longLog(), 'utf8'),
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

describe('the bash spill failure paths', () => {
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
});
