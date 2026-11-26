import { drizzle } from 'drizzle-orm/postgres-js';
import type { Db } from '../db/tenant-db.service';
import type { TenantRunner } from '../db/tenant-db.service';
import { ArtifactsRepository } from './artifacts/artifacts-repository';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { previewStream, spillBashResult, spillBashStreams } from './bash-spill';
import { renderToolResultText } from './model-text';
import type { ToolContext, ToolResult } from './types';
import type { BashKnownResult } from '@workspace/bash-executor';
import type { MockInstance } from 'vitest';

const SEQ = 5;
const CREATED_AT = new Date('2026-11-02T12:00:00.000Z');

type ArtifactWrites = {
  readonly nextSeq: MockInstance<ArtifactsRepository['nextSeq']>;
  readonly insertArtifact: MockInstance<ArtifactsRepository['insertArtifact']>;
  readonly insertParts: MockInstance<ArtifactsRepository['insertParts']>;
};

let insertWrites: ArtifactWrites;

function testContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const db: Db = drizzle.mock();

  const tenantDb: TenantRunner = {
    runAs: (_userId, callback) => Promise.resolve(callback(db)),
  };

  return {
    userId: 'owner',
    chatId: 'chat',
    runId: 'run',
    toolCallId: 'call-1',
    permissionPolicy: compileTestPermissionPolicy(),
    artifactReadable: true,
    tenantDb,
    configuredCredentials: [],
    ...overrides,
  };
}

function success(stdout: string): BashKnownResult {
  return {
    status: 'success',
    exitCode: 0,
    stdout,
    stderr: '',
    truncated: false,
    wallTimeMs: 12,
  };
}

function textOf(result: ToolResult): string {
  return renderToolResultText('bash', result);
}

beforeEach(() => {
  vi.clearAllMocks();
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

afterEach(() => vi.restoreAllMocks());

describe('bash output spill', () => {
  it('keeps head and tail around the omitted line when a stream spills', async () => {
    const output = Array.from(
      { length: 5000 },
      (_, index) =>
        `line ${String(index + 1).padStart(4, '0')} ${'x'.repeat(89)}`,
    ).join('\n');

    const result = await spillBashResult(testContext(), success(output));

    expect(result.status).toBe('success');
    expect(textOf(result)).toContain(
      '[lines 41-4880 omitted; read artifact://bash-5/stdout:L41-4880]',
    );
    expect(textOf(result).split('\n').at(-1)).toBe(
      '[full result: artifact://bash-5/stdout (5000 lines)]',
    );
    expect(insertWrites.insertParts).toHaveBeenCalledTimes(1);
  });

  it('does not disclose a host path in the artifact notice', async () => {
    const result = await spillBashResult(
      testContext({ artifactHostFiles: true }),
      success('a'.repeat(20_000)),
    );

    expect(textOf(result)).toContain(
      '[full result: artifact://bash-5/stdout (3 lines)]',
    );
    expect(textOf(result)).not.toContain('/tmp/');
    expect(textOf(result)).not.toContain('machine://');
  });

  it('uses a line boundary and avoids splitting a surrogate pair', () => {
    expect(previewStream('a'.repeat(20_000), 16_000).omitted).toEqual({
      first: 1,
      last: 2,
    });
    const preview = previewStream('😀'.repeat(10), 9);
    expect([...preview.head, ...preview.tail].join('')).toBe('😀😀😀😀');
  });

  it('keeps inline streams when artifact storage is unavailable', async () => {
    const result = await spillBashStreams(
      testContext({ artifactReadable: false }),
      { stdout: 'a'.repeat(20_000), stderr: '' },
    );

    expect(result.artifact).toBeUndefined();
    expect(result.streams.stdout).toContain('full result not stored');
    expect(insertWrites.insertParts).not.toHaveBeenCalled();
  });
});
