/**
 * The `head` spill at the cap sites (tool-result-artifacts D3, D6): the whole
 * rendering is stored when the Run can read it, the inline part keeps its head,
 * a rendering above the bound or a failed write is not stored, and a Run with
 * no reader keeps today's bounded result.
 */

import { getEventListeners } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { compileToolPermissionMap } from '../permissions/compile-permissions';
import { type ToolContext, type ToolResult } from '../types';

import { type TenantRunner } from '../../db/tenant-db.service';
import { ArtifactsRepository } from './artifacts-repository';
import { artifactDirectory } from './host-files';
import {
  artifactMaxBytes,
  capHeadResult,
  storeSinglePartArtifact,
} from './spill';
import { isString, RESULT_TRUNCATE_CHARS } from '@workspace/runtime-safety';
import { createWorkspaceRootCell } from '../workspace-path';

const TOOL = 'mcp__docs__fetch';
const LOCATOR = 'artifact://mcp__docs__fetch-4';
const fakeDispatchDb = drizzle.mock();

const tenantDb: TenantRunner = {
  runAs: (_userId, fn) => Promise.resolve(fn(fakeDispatchDb)),
};

interface StorageSpies {
  readonly nextSeq: MockInstance<ArtifactsRepository['nextSeq']>;
  readonly insertArtifact: MockInstance<ArtifactsRepository['insertArtifact']>;
  readonly insertParts: MockInstance<ArtifactsRepository['insertParts']>;
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: 'user-1',
    chatId: 'chat-1',
    runId: 'run-1',
    toolCallId: 'call-1',
    artifactReadable: true,
    tenantDb,
    permissionPolicy: compileToolPermissionMap(
      { read: { allow: true } },
      'test-policy',
    ),
    ...overrides,
    configuredCredentials: overrides.configuredCredentials ?? [],
  };
}

function hugeResult(size = 40_000): ToolResult {
  return { status: 'success', output: 'x'.repeat(size) };
}

/** The notice of a capped success result. */
function noticeOf(result: ToolResult): string {
  if (result.status !== 'success' || !isString(result.truncationNotice)) {
    throw new Error(`Expected a capped result, got ${JSON.stringify(result)}`);
  }

  return result.truncationNotice;
}

/**
 * The artifact line count of a stored text, counted here rather than read back
 * from the writer: each source line is one artifact line, and a line over
 * 8,000 units is one line per piece (tool-result-artifacts D2).
 */
function artifactLines(text: string): number {
  return text
    .split('\n')
    .reduce(
      (total, line) => total + Math.max(1, Math.ceil(line.length / 8000)),
      0,
    );
}

function spyStorage(seq = 4): StorageSpies {
  return {
    nextSeq: vi
      .spyOn(ArtifactsRepository.prototype, 'nextSeq')
      .mockResolvedValue(seq),
    insertArtifact: vi
      .spyOn(ArtifactsRepository.prototype, 'insertArtifact')
      .mockResolvedValue({
        id: 'artifact-id',
        createdAt: new Date('2026-11-02T12:00:00.000Z'),
      }),
    insertParts: vi
      .spyOn(ArtifactsRepository.prototype, 'insertParts')
      .mockResolvedValue(undefined),
  };
}

const hostRoots: Array<string> = [];

/** A private `$TMPDIR` for this test's host files. */
function hostTmpdir(): string {
  const root = mkdtempSync(join(tmpdir(), 'head-spill-host-'));
  hostRoots.push(root);
  vi.stubEnv('TMPDIR', root);

  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();

  for (const root of hostRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('capHeadResult', () => {
  it('keeps the head of the rendering inline', async () => {
    const result = await capHeadResult(
      context({ artifactReadable: false }),
      TOOL,
      hugeResult(),
    );

    expect(result).toMatchObject({ status: 'success', truncated: true });

    if (result.status !== 'success' || !isString(result.output)) {
      throw new Error('Expected a capped success result.');
    }

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      RESULT_TRUNCATE_CHARS,
    );
    expect(result.output.startsWith('xxxx')).toBe(true);
    expect(result.output.startsWith('x'.repeat(40_000))).toBe(false);
  });

  it('writes a host file and names its directory for a bash-capable Run', async () => {
    spyStorage(4);
    const hostRoot = mkdtempSync(join(tmpdir(), 'head-spill-host-'));
    vi.stubEnv('TMPDIR', hostRoot);

    try {
      const result = await capHeadResult(
        context({ artifactHostFiles: true }),
        TOOL,
        hugeResult(),
      );

      expect(noticeOf(result)).toContain(`[full result: ${LOCATOR} (`);
      expect(noticeOf(result)).toContain(
        `; host files in ${artifactDirectory('chat-1')}]`,
      );
      const file = join(artifactDirectory('chat-1'), 'mcp__docs__fetch-4.json');
      expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
        status: 'success',
      });
    } finally {
      rmSync(hostRoot, { recursive: true, force: true });
    }
  });

  it('does not cap a result that fits', async () => {
    const storage = spyStorage();

    const result = await capHeadResult(context(), TOOL, {
      status: 'success',
      output: 'fits',
    });

    expect(result).toEqual({ status: 'success', output: 'fits' });
    expect(storage.insertArtifact).not.toHaveBeenCalled();
  });

  it('names the stored artifact, its lines, and the read range', async () => {
    const storage = spyStorage(4);
    const result = await capHeadResult(context(), TOOL, hugeResult());

    expect(storage.insertArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        toolName: TOOL,
        complete: true,
      }),
    );
    const stored = storage.insertParts.mock.calls[0]?.[1][0];

    if (stored === undefined) throw new Error('Expected a stored part.');
    expect(stored.contentType).toBe('application/json');
    // The part holds the whole rendering, pretty-printed, not the cut result.
    const text = stored.content.toString('utf8');
    expect(text).toBe(JSON.stringify(hugeResult(), null, 2));
    expect(result).toMatchObject({ artifact: LOCATOR, truncated: true });
    expect(noticeOf(result)).toContain(
      `[full result: ${LOCATOR} (${artifactLines(text)} lines); continue with ${LOCATOR}:1-]`,
    );
  });

  it('does not store a rendering above the byte bound', async () => {
    const storage = spyStorage();

    const result = await capHeadResult(
      context({ artifactMaxBytes: 131_072 }),
      TOOL,
      hugeResult(400_000),
    );

    expect(storage.insertArtifact).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('artifact');
    expect(noticeOf(result)).toContain('[full result not stored]');
  });

  it('keeps the inline result when the write fails', async () => {
    spyStorage();
    vi.spyOn(ArtifactsRepository.prototype, 'insertParts').mockRejectedValue(
      new Error('refused'),
    );
    const result = await capHeadResult(context(), TOOL, hugeResult());

    expect(result).not.toHaveProperty('artifact');
    expect(result).toMatchObject({ status: 'success', truncated: true });
    expect(noticeOf(result)).toContain('[full result not stored]');
  });

  it('stores nothing when the Run cannot read artifacts', async () => {
    const storage = spyStorage();

    const result = await capHeadResult(
      context({ artifactReadable: false, permissionPolicy: undefined }),
      TOOL,
      hugeResult(),
    );

    expect(storage.insertArtifact).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('artifact');
    expect(noticeOf(result)).not.toContain('[full result not stored]');
  });

  it('stores a head artifact through host files when read is not a route', async () => {
    const hostRoot = hostTmpdir();
    spyStorage(4);

    const result = await capHeadResult(
      context({
        artifactReadable: false,
        artifactHostFiles: true,
        permissionPolicy: compileToolPermissionMap(
          { bash: { allow: true } },
          'test-policy',
        ),
      }),
      TOOL,
      hugeResult(),
    );

    expect(result).toMatchObject({ artifact: LOCATOR });
    expect(noticeOf(result)).toContain(
      `; host files in ${artifactDirectory('chat-1')}]`,
    );
    expect(hostRoot).not.toBe('');
  });

  it('keeps the inline result when the host route has no file', async () => {
    const hostRoot = hostTmpdir();
    writeFileSync(join(hostRoot, 'llame'), '');
    const storage = spyStorage(4);

    const result = await capHeadResult(
      context({
        artifactReadable: false,
        artifactHostFiles: true,
        permissionPolicy: compileToolPermissionMap(
          { bash: { allow: true } },
          'test-policy',
        ),
      }),
      TOOL,
      hugeResult(),
    );

    // The row was written, but no file exists to name, and `read` is not a
    // route, so nothing is advertised.
    expect(storage.insertArtifact).toHaveBeenCalled();
    expect(result).not.toHaveProperty('artifact');
    expect(noticeOf(result)).toContain('[full result not stored]');
  });

  it('says the files are on the llame host only in a Machine Workspace', async () => {
    hostTmpdir();
    spyStorage(4);

    const result = await capHeadResult(
      context({
        artifactHostFiles: true,
        workspaceRoot: createWorkspaceRootCell('machine://devl/srv/app'),
      }),
      TOOL,
      hugeResult(),
    );

    expect(noticeOf(result)).toContain('; host files on the llame host only]');
  });

  it('stores nothing outside a Run', async () => {
    const storage = spyStorage();

    const result = await capHeadResult(
      context({ runId: undefined }),
      TOOL,
      hugeResult(),
    );

    expect(storage.insertArtifact).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('artifact');
    expect(noticeOf(result)).not.toContain('[full result not stored]');
  });

  it('stores a text rendering as rendered', async () => {
    const storage = spyStorage(4);
    const body = 'passage\n'.repeat(3000);

    const result = await capHeadResult(context(), 'read', {
      status: 'success',
      kind: 'file',
      path: 'a.txt',
      content: body,
      truncated: false,
    });

    const stored = storage.insertParts.mock.calls[0]?.[1][0];

    if (stored === undefined) throw new Error('Expected a stored part.');
    expect(stored.contentType).toBe('text/plain');
    const text = stored.content.toString('utf8');
    expect(text.split('\n')[0]).toContain('a.txt');
    expect(text).toContain('passage');
    expect(text).not.toContain('"status"');
    expect(result).toMatchObject({ artifact: 'artifact://read-4' });
  });

  it('never spills an error result', async () => {
    const storage = spyStorage();

    const errorResult: ToolResult = {
      status: 'error',
      type: 'command_failed',
      message: 'x'.repeat(20_000),
    };

    const result = await capHeadResult(context(), 'bash', errorResult);

    expect(result).toBe(errorResult);
    expect(storage.insertArtifact).not.toHaveBeenCalled();
  });

  it('does not advertise a locator the read group refuses after allocation', async () => {
    const storage = spyStorage(4);

    const result = await capHeadResult(
      context({
        permissionPolicy: compileToolPermissionMap(
          {
            read: {
              allow: [
                { field: 'path', literal: 'artifact://mcp__docs__fetch-1' },
              ],
            },
          },
          'test-policy',
        ),
      }),
      TOOL,
      hugeResult(),
    );

    // The probe (sequence 1) admitted the write, but sequence 4 is refused.
    expect(storage.insertArtifact).toHaveBeenCalledOnce();
    expect(result).not.toHaveProperty('artifact');
    expect(noticeOf(result)).toContain('[full result not stored]');
  });

  it('keeps a rendering exactly at the cap inline', async () => {
    const storage = spyStorage();
    const framing = JSON.stringify({ status: 'success', output: '' }).length;

    const result = await capHeadResult(context(), TOOL, {
      status: 'success',
      output: 'x'.repeat(RESULT_TRUNCATE_CHARS - framing),
    });

    expect(JSON.stringify(result).length).toBe(RESULT_TRUNCATE_CHARS);
    expect(storage.insertArtifact).not.toHaveBeenCalled();
    expect(result).not.toMatchObject({ truncated: true });
  });

  it('resolves not-stored when the deadline aborts mid-write', async () => {
    const storage = spyStorage();
    let releaseSeq!: (seq: number) => void;
    storage.nextSeq.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          releaseSeq = resolve;
        }),
    );
    const controller = new AbortController();

    const pending = capHeadResult(
      context({ abortSignal: controller.signal }),
      TOOL,
      hugeResult(),
    );

    controller.abort();
    const result = await pending;

    expect(storage.insertArtifact).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('artifact');
    expect(noticeOf(result)).toContain('[full result not stored]');
    releaseSeq(4);
    await Promise.resolve();
  });

  it('resolves not-stored when the write rejects', async () => {
    spyStorage();
    vi.spyOn(ArtifactsRepository.prototype, 'insertArtifact').mockRejectedValue(
      new Error('refused'),
    );
    const controller = new AbortController();

    const result = await capHeadResult(
      context({ abortSignal: controller.signal }),
      TOOL,
      hugeResult(),
    );

    expect(result).not.toHaveProperty('artifact');
    expect(noticeOf(result)).toContain('[full result not stored]');
  });

  it('removes the abort listener once the write settles', async () => {
    spyStorage(4);
    const controller = new AbortController();

    const result = await capHeadResult(
      context({ abortSignal: controller.signal }),
      TOOL,
      hugeResult(),
    );

    expect(result).toMatchObject({ artifact: LOCATOR });
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('does not write past the deadline', async () => {
    const storage = spyStorage();

    const result = await capHeadResult(
      context({ abortSignal: AbortSignal.abort() }),
      TOOL,
      hugeResult(),
    );

    expect(storage.insertArtifact).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('artifact');
  });
});

describe('artifactMaxBytes', () => {
  it('uses the configured bound, or the built-in one', () => {
    expect(artifactMaxBytes(context({ artifactMaxBytes: 1024 }))).toBe(1024);
    expect(artifactMaxBytes(context())).toBe(8_388_608);
  });
});

describe('the shared single-part store', () => {
  const findings = {
    version: 1,
    findings: [{ locators: ['/r/a.ts'], rule: 'allow_only', start: 1, end: 2 }],
  };

  it('stores the findings document of a part that carries one', async () => {
    const spies = spyStorage(4);

    const written = await storeSinglePartArtifact(context(), 'grep', {
      contentType: 'text/markdown',
      content: '## /r/a.ts\n*1: x\n',
      findings,
      complete: false,
    });

    expect(written?.locator).toBe('artifact://grep-4');
    const part = spies.insertParts.mock.calls[0]?.[1]?.[0];
    expect(part?.findings).toEqual(findings);
    expect(part?.contentType).toBe('text/markdown');
  });

  it('stores no findings record for a part that carries none', async () => {
    const spies = spyStorage(5);
    await storeSinglePartArtifact(context(), 'mcp__docs__fetch', {
      contentType: 'text/plain',
      content: 'plain',
    });

    const part = spies.insertParts.mock.calls[0]?.[1]?.[0];
    expect(part?.findings).toBeNull();
  });
});

describe('the shared store on a bash-only route', () => {
  const part = { contentType: 'text/markdown', content: '## /r/a.ts\n*1: x\n' };

  /** A `$TMPDIR` that cannot hold the Chat directory, so no host file lands. */
  function withoutHostFiles<T>(callback: () => Promise<T>): Promise<T> {
    const previous = process.env['TMPDIR'];
    const blocker = mkdtempSync(join(tmpdir(), 'spill-block-'));
    const file = join(blocker, 'file');
    writeFileSync(file, 'x');
    process.env['TMPDIR'] = file;

    return callback().finally(() => {
      if (previous === undefined) delete process.env['TMPDIR'];
      else process.env['TMPDIR'] = previous;
      rmSync(blocker, { recursive: true, force: true });
    });
  }

  it('stores nothing when the host file is missing and read denies it', async () => {
    await withoutHostFiles(async () => {
      const spies = spyStorage(6);

      const written = await storeSinglePartArtifact(
        context({
          artifactReadable: false,
          artifactHostFiles: true,
          permissionPolicy: compileToolPermissionMap(
            { read: { reject: true }, bash: { allow: true } },
            'test-policy',
          ),
        }),
        'grep',
        part,
      );

      // The row was written before the host files, but nothing can reach it,
      // so the producer must fall back instead of advertising a locator.
      expect(written).toBeUndefined();
      expect(spies.insertParts).toHaveBeenCalledTimes(1);
    });
  });

  it('stores the artifact when read reaches it without host files', async () => {
    await withoutHostFiles(async () => {
      spyStorage(7);

      const written = await storeSinglePartArtifact(
        context({
          artifactHostFiles: true,
          permissionPolicy: compileToolPermissionMap(
            { read: { allow: true }, bash: { allow: true } },
            'test-policy',
          ),
        }),
        'grep',
        part,
      );

      expect(written?.locator).toBe('artifact://grep-7');
      expect(written?.hostDirectory).toBeUndefined();
    });
  });
});
