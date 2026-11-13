/**
 * Artifact writer unit tests — the request shape, the byte bound, and the two
 * transactions, with the repository scripted. The live database behavior
 * (numbering, conflicts, RLS) is in artifact-store.integration.test.ts.
 */

import { drizzle } from 'drizzle-orm/postgres-js';

import { type TenantRunner } from '../../db/tenant-db.service';
import { ArtifactsRepository } from './artifacts-repository';
import {
  writeToolArtifact,
  type ArtifactWriteRequest,
} from './artifact-writer';

const MAX_BYTES = 1024;
const RUN_ID = '00000000-0000-4000-8000-000000000010';
const CHAT_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = 'owner-1';
const CREATED_AT = new Date('2026-11-02T12:00:00.000Z');

function tenantRunner(): TenantRunner {
  const db = drizzle.mock();
  const runAs: TenantRunner['runAs'] = (_userId, fn) => fn(db);

  return { runAs };
}

function request(
  overrides: Partial<ArtifactWriteRequest> = {},
): ArtifactWriteRequest {
  return {
    chatId: CHAT_ID,
    userId: USER_ID,
    runId: RUN_ID,
    toolCallId: 'call-1',
    toolName: 'grep',
    complete: true,
    parts: [{ contentType: 'text/markdown', content: Buffer.from('# file\n') }],
    ...overrides,
  };
}

describe('writeToolArtifact', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function scriptRepository(seq = 7) {
    const nextSeq = vi
      .spyOn(ArtifactsRepository.prototype, 'nextSeq')
      .mockResolvedValue(seq);

    const insertArtifact = vi
      .spyOn(ArtifactsRepository.prototype, 'insertArtifact')
      .mockResolvedValue({ id: 'artifact-id', createdAt: CREATED_AT });

    const insertParts = vi
      .spyOn(ArtifactsRepository.prototype, 'insertParts')
      .mockResolvedValue(undefined);

    return { nextSeq, insertArtifact, insertParts };
  }

  it('stores one unnamed part with its digest and sizes', async () => {
    const scripted = scriptRepository();

    const written = await writeToolArtifact(
      tenantRunner(),
      request({
        parts: [
          {
            contentType: 'text/markdown',
            content: Buffer.from('a\nb\n'),
            findings: [{ locator: '/r/a.ts' }],
          },
        ],
      }),
      { maxBytes: MAX_BYTES },
    );

    expect(written).toEqual({
      id: 'artifact-id',
      seq: 7,
      locator: 'artifact://grep-7',
      lineCount: 2,
      byteSize: 4,
    });
    expect(scripted.insertArtifact).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      seq: 7,
      toolName: 'grep',
      toolCallId: 'call-1',
      runId: RUN_ID,
      complete: true,
    });
    const parts = scripted.insertParts.mock.calls[0][1];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      name: '',
      contentType: 'text/markdown',
      byteSize: 4,
      lineCount: 2,
      findings: [{ locator: '/r/a.ts' }],
    });
    expect(parts[0].sha256).toBe(
      '911169ddaaf146aff539f58c26c489af3b892dff0fe283c1c264c65ae5aa59a2',
    );
  });

  it('defaults findings to null', async () => {
    const scripted = scriptRepository();
    await writeToolArtifact(tenantRunner(), request(), { maxBytes: MAX_BYTES });

    const parts = scripted.insertParts.mock.calls[0][1];
    expect(parts[0].findings).toBeNull();
  });

  it('accepts a part exactly at the byte bound and refuses one over it', async () => {
    scriptRepository();

    const atBound = await writeToolArtifact(
      tenantRunner(),
      request({
        parts: [
          { contentType: 'text/plain', content: Buffer.alloc(MAX_BYTES, 97) },
        ],
      }),
      { maxBytes: MAX_BYTES },
    );

    expect(atBound.byteSize).toBe(MAX_BYTES);

    vi.restoreAllMocks();
    const scripted = scriptRepository();

    const overBound = writeToolArtifact(
      tenantRunner(),
      request({
        parts: [
          {
            contentType: 'text/plain',
            content: Buffer.alloc(MAX_BYTES + 1, 97),
          },
        ],
      }),
      { maxBytes: MAX_BYTES },
    );

    await expect(overBound).rejects.toThrow(
      'An artifact part exceeds tools.artifacts.maxBytes.',
    );
    expect(scripted.nextSeq).not.toHaveBeenCalled();
  });

  it('refuses an unusable tool name before numbering', async () => {
    const scripted = scriptRepository();

    await expect(
      writeToolArtifact(tenantRunner(), request({ toolName: 'grep tool' }), {
        maxBytes: MAX_BYTES,
      }),
    ).rejects.toThrow('"grep tool" is not a usable artifact tool name');
    expect(scripted.nextSeq).not.toHaveBeenCalled();
  });

  it('refuses an empty part set', async () => {
    scriptRepository();

    await expect(
      writeToolArtifact(tenantRunner(), request({ parts: [] }), {
        maxBytes: MAX_BYTES,
      }),
    ).rejects.toThrow('An artifact needs at least one part.');
  });

  it('refuses a named part on a tool that has one unnamed part', async () => {
    scriptRepository();

    await expect(
      writeToolArtifact(
        tenantRunner(),
        request({
          parts: [
            {
              name: 'stdout',
              contentType: 'text/plain',
              content: Buffer.from('o'),
            },
          ],
        }),
        { maxBytes: MAX_BYTES },
      ),
    ).rejects.toThrow('An artifact of this tool has one unnamed part.');

    await expect(
      writeToolArtifact(
        tenantRunner(),
        request({
          parts: [
            { contentType: 'text/plain', content: Buffer.from('o') },
            { contentType: 'text/plain', content: Buffer.from('e') },
          ],
        }),
        { maxBytes: MAX_BYTES },
      ),
    ).rejects.toThrow('An artifact of this tool has one unnamed part.');
  });

  it('refuses an unnamed part on a bash artifact', async () => {
    scriptRepository();

    await expect(
      writeToolArtifact(
        tenantRunner(),
        request({
          toolName: 'bash',
          parts: [
            {
              name: 'stdout',
              contentType: 'text/plain',
              content: Buffer.from('o'),
            },
            { contentType: 'text/plain', content: Buffer.from('e') },
          ],
        }),
        { maxBytes: MAX_BYTES },
      ),
    ).rejects.toThrow('A bash artifact names every part by stream.');
  });

  it('refuses a part name a host path cannot carry', async () => {
    scriptRepository();

    for (const name of ['Stdout', '1stdout', 'a/b', 'a b']) {
      await expect(
        writeToolArtifact(
          tenantRunner(),
          request({
            toolName: 'bash',
            parts: [
              { name, contentType: 'text/plain', content: Buffer.from('x') },
            ],
          }),
          { maxBytes: MAX_BYTES },
        ),
      ).rejects.toThrow(`"${name}" is not a usable artifact part name`);
    }
  });

  it('refuses duplicate part names', async () => {
    scriptRepository();

    await expect(
      writeToolArtifact(
        tenantRunner(),
        request({
          toolName: 'bash',
          parts: [
            {
              name: 'stdout',
              contentType: 'text/plain',
              content: Buffer.from('o'),
            },
            {
              name: 'stdout',
              contentType: 'text/plain',
              content: Buffer.from('e'),
            },
          ],
        }),
        { maxBytes: MAX_BYTES },
      ),
    ).rejects.toThrow('An artifact part names must be distinct.');
  });

  it('stores each stream of a bash artifact and sums both sizes', async () => {
    scriptRepository();

    const written = await writeToolArtifact(
      tenantRunner(),
      request({
        toolName: 'bash',
        parts: [
          {
            name: 'stdout',
            contentType: 'text/plain',
            content: Buffer.from('o\n'),
          },
          {
            name: 'stderr',
            contentType: 'text/plain',
            content: Buffer.from('ee\n'),
          },
        ],
      }),
      { maxBytes: MAX_BYTES },
    );

    expect(written).toMatchObject({
      locator: 'artifact://bash-7',
      lineCount: 2,
      byteSize: 5,
    });
  });

  it('reports a Chat that cannot store an artifact', async () => {
    scriptRepository();
    vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(
      undefined,
    );

    await expect(
      writeToolArtifact(tenantRunner(), request(), { maxBytes: MAX_BYTES }),
    ).rejects.toThrow('The Chat cannot store an artifact.');
  });

  it('reports a failed part insert', async () => {
    scriptRepository();
    vi.spyOn(ArtifactsRepository.prototype, 'insertParts').mockRejectedValue(
      new Error('write failed'),
    );

    await expect(
      writeToolArtifact(tenantRunner(), request(), { maxBytes: MAX_BYTES }),
    ).rejects.toThrow('write failed');
  });
});
