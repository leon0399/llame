/**
 * The `head` spill at the cap sites (tool-result-artifacts D3, D6): the whole
 * rendering is stored when the Run can read it, the inline part keeps its head,
 * a rendering above the bound or a failed write is not stored, and a Run with
 * no reader keeps today's bounded result.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { compileToolPermissionMap } from '../permissions/compile-permissions';
import { type ToolContext, type ToolResult } from '../types';
import * as schema from '../../db/schema';
import { type TenantRunner } from '../../db/tenant-db.service';
import { ArtifactsRepository } from './artifacts-repository';
import { artifactMaxBytes, capHeadResult, runCanReadArtifacts } from './spill';
import { isNumber, isString } from '@workspace/runtime-safety';

const TOOL = 'mcp__docs__fetch';
const LOCATOR = 'artifact://mcp__docs__fetch-4';
const fakeDispatchDb = drizzle.mock({ schema });

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

/** The artifact line count the writer derived from the stored part. */
function storedLineCount(storage: StorageSpies): number {
  const call = storage.insertParts.mock.calls[0];
  const lineCount = call?.[1][0]?.lineCount;
  if (call === undefined || !isNumber(lineCount)) {
    throw new Error('Expected a stored artifact part.');
  }
  return lineCount;
}

function spyStorage(seq = 4): StorageSpies {
  return {
    nextSeq: vi
      .spyOn(ArtifactsRepository.prototype, 'nextSeq')
      .mockResolvedValue(seq),
    insertArtifact: vi
      .spyOn(ArtifactsRepository.prototype, 'insertArtifact')
      .mockResolvedValue('artifact-id'),
    insertParts: vi
      .spyOn(ArtifactsRepository.prototype, 'insertParts')
      .mockResolvedValue(undefined),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
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
    expect(result.output.length).toBeLessThan(40_000);
    expect(result.output.startsWith('xxxx')).toBe(true);
    expect(result.output.startsWith('x'.repeat(40_000))).toBe(false);
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
    const lineCount = storedLineCount(storage);
    const stored = storage.insertParts.mock.calls[0]?.[1][0];
    if (stored === undefined) throw new Error('Expected a stored part.');
    expect(stored.contentType).toBe('application/json');
    // A JSON rendering is stored pretty-printed, one member on each line.
    expect(stored.content.toString('utf8')).toContain(
      '{\n  "status": "success",\n  "output": "xxxxxxxx',
    );
    expect(result).toMatchObject({ artifact: LOCATOR, truncated: true });
    expect(noticeOf(result)).toContain(
      `The full result is ${LOCATOR} (${lineCount} lines); read it from ${LOCATOR}:1-.`,
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
});

describe('runCanReadArtifacts', () => {
  it('is true when bash runs on the llame host with host files', () => {
    expect(
      runCanReadArtifacts(
        context({ artifactReadable: false, artifactHostFiles: true }),
        TOOL,
      ),
    ).toBe(true);
  });

  it('needs read in tools.allowed', () => {
    expect(
      runCanReadArtifacts(
        context({ artifactReadable: false, artifactHostFiles: false }),
        TOOL,
      ),
    ).toBe(false);
  });

  it('needs the read group to admit the artifact locator', () => {
    const denied = context({
      artifactReadable: true,
      permissionPolicy: compileToolPermissionMap(
        { read: { allow: [{ field: 'path', literal: '/repo/**' }] } },
        'test-policy',
      ),
    });
    const allowed = context({
      artifactReadable: true,
      permissionPolicy: compileToolPermissionMap(
        { read: { allow: [{ field: 'path', regex: '^artifact://' }] } },
        'test-policy',
      ),
    });

    expect(runCanReadArtifacts(denied, TOOL)).toBe(false);
    expect(runCanReadArtifacts(allowed, TOOL)).toBe(true);
  });

  it('fails closed without a compiled policy', () => {
    expect(
      runCanReadArtifacts(
        context({ artifactReadable: true, permissionPolicy: undefined }),
        TOOL,
      ),
    ).toBe(false);
  });
});

describe('artifactMaxBytes', () => {
  it('uses the configured bound, or the built-in one', () => {
    expect(artifactMaxBytes(context({ artifactMaxBytes: 1024 }))).toBe(1024);
    expect(artifactMaxBytes(context())).toBe(8_388_608);
  });
});
