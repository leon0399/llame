import { PassThrough } from 'node:stream';
import { afterEach, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  SearchFilesRequestSchema,
  SearchFilesResponseSchema,
  SearchStop,
  SkipReason,
  type SearchFilesRequest,
  type SearchFilesResponse,
} from '@workspace/machine-protocol';
import { MachineSession } from '../machine-session.js';
import { searchHandlers } from './search.js';

const sessions: Array<MachineSession> = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.close();
});

const BASE = {
  envelope: { budgetMs: 10_000 },
  path: '/repo',
  globSuffix: '**',
  patterns: ['needle'],
  literal: true,
  ignoreCase: false,
  bounds: {
    files: null,
    entries: null,
    bytes: null,
    fileBytes: null,
    deadlineMs: 10_000,
    limit: 100,
    pageUnits: 180,
    progressed: false,
  },
} as const;

function match(path: string, line: number, text: string): SearchFilesResponse {
  return create(SearchFilesResponseSchema, {
    event: {
      case: 'match',
      value: {
        path,
        line,
        lines: [{ number: line, text, spans: [{ start: 0, end: 6 }] }],
      },
    },
  });
}

function skipped(path: string, reason: SkipReason): SearchFilesResponse {
  return create(SearchFilesResponseSchema, {
    event: { case: 'skipped', value: { path, reason } },
  });
}

function ended(
  stop = SearchStop.COMPLETE,
  position?: { path: string; line: number; byteOffset?: bigint },
  files = 2,
): SearchFilesResponse {
  return create(SearchFilesResponseSchema, {
    event: {
      case: 'end',
      value: {
        stop,
        ...(position && { position }),
        files,
        bytes: 40n,
        matches: 2,
      },
    },
  });
}

function sessionFor(
  streams: Array<Array<SearchFilesResponse>>,
  requests: Array<SearchFilesRequest> = [],
) {
  let call = 0;
  const connection = new PassThrough();

  const session = new MachineSession({
    name: 'search-test',
    hubVersion: 'test',
    transport: {
      input: connection,
      output: connection,
      close: () => connection.end(),
      ended: new Promise(() => undefined),
    },
  });

  sessions.push(session);
  vi.spyOn(session.clients.files, 'searchFiles').mockImplementation(
    (request) => {
      requests.push(create(SearchFilesRequestSchema, request));
      const events = streams[call++] ?? [];

      return (async function* () {
        await Promise.resolve();
        yield* events;
      })();
    },
  );

  return { session, requests };
}

describe('wire fs.grep', () => {
  it('merges overlapping context, returns warning and consumed counters', async () => {
    const { session } = sessionFor([
      [
        match('src/a.ts', 2, 'needle one'),
        create(SearchFilesResponseSchema, {
          event: {
            case: 'match',
            value: {
              path: 'src/a.ts',
              line: 5,
              lines: [
                {
                  number: 2,
                  text: 'needle one',
                  spans: [{ start: 0, end: 6 }],
                },
                { number: 3, text: 'middle', spans: [] },
                { number: 4, text: 'middle two', spans: [] },
                {
                  number: 5,
                  text: 'needle two',
                  spans: [{ start: 0, end: 6 }],
                },
              ],
            },
          },
        }),
        skipped('.git', SkipReason.IGNORED),
        skipped('bad.bin', SkipReason.BINARY),
        ended(),
      ],
    ]);

    const result = await searchHandlers['fs.grep']!(session, {
      ...BASE,
      bounds: { ...BASE.bounds, pageUnits: 1000 },
    });

    expect(result).toMatchObject({
      ok: true,
      complete: true,
      warnings: [{ kind: 'binary', count: 1 }],
      consumed: { files: 2, entries: 2, bytes: 40 },
      ignored: { paths: ['.git'], atLeast: false },
      results: [
        {
          path: 'src/a.ts',
          startLine: 2,
          endLine: 5,
          matches: [2, 5],
          content: '2: needle one\n3: middle\n4: middle two\n5: needle two',
        },
      ],
    });
  });
  it('caps excluded directory paths while retaining the lower-bound count', async () => {
    const { session } = sessionFor([
      [
        ...Array.from({ length: 1001 }, (_, index) =>
          skipped(`ignored-${index}`, SkipReason.IGNORED),
        ),
        ended(),
      ],
    ]);

    const result = await searchHandlers['fs.grep']!(session, {
      ...BASE,
      bounds: { ...BASE.bounds, pageUnits: 1000 },
    });

    expect(result).toMatchObject({
      ok: true,
      ignored: {
        paths: expect.arrayContaining(['ignored-0', 'ignored-999']),
        atLeast: true,
      },
    });
    if (!('ok' in result) || !result.ok)
      throw new Error('Expected a successful search result.');
    expect(result.ignored?.paths).toHaveLength(1000);
  });


  it('mints an input-bound cursor and resumes the second page at the hub position', async () => {
    const { session, requests } = sessionFor([
      [
        match('a.ts', 1, 'needle first'),
        match('b.ts', 1, 'needle second'),
        ended(),
      ],
      [match('b.ts', 1, 'needle second'), ended()],
    ]);

    const first = await searchHandlers['fs.grep']!(session, BASE);
    expect(first).toMatchObject({
      ok: true,
      complete: false,
      results: [{ path: 'a.ts' }],
    });

    if (!('ok' in first) || !first.ok || first.cursor === undefined)
      throw new Error('Expected a continuation cursor.');
    expect(first.results[0]?.cut).toBe(true);
    expect(
      JSON.parse(Buffer.from(first.cursor, 'base64url').toString('utf8')),
    ).toHaveProperty('inputHash', expect.stringContaining('/repo'));

    const second = await searchHandlers['fs.grep']!(session, {
      ...BASE,
      cursor: first.cursor,
    });

    expect(requests[1]?.after).toMatchObject({ path: 'a.ts', line: 1 });
    expect(second).toMatchObject({
      ok: true,
      complete: true,
      results: [{ path: 'b.ts' }],
    });
  });
  it('caps passages per file at twenty and marks the twentieth', async () => {
    const events = Array.from({ length: 21 }, (_, index) =>
      match('many.txt', index * 5 + 1, 'needle'),
    );

    const { session } = sessionFor([[...events, ended()]]);

    const result = await searchHandlers['fs.grep']!(session, {
      ...BASE,
      bounds: { ...BASE.bounds, pageUnits: 10_000 },
    });

    expect(result).toMatchObject({
      ok: true,
      complete: true,
      results: { length: 20 },
    });

    if (!('ok' in result) || !result.ok)
      throw new Error('Expected successful grep results.');
    expect(result.results[19]).toMatchObject({ capped: true });
  });
  it('round-trips byte offsets through bounded-search cursors', async () => {
    const { session, requests } = sessionFor([
      [
        ended(
          SearchStop.BYTES,
          { path: 'large.txt', line: 12, byteOffset: 65_537n },
          1,
        ),
      ],
      [ended()],
    ]);

    const first = await searchHandlers['fs.grep']!(session, BASE);

    if (!('ok' in first) || !first.ok || first.cursor === undefined)
      throw new Error('Expected a byte-bounded continuation cursor.');

    expect(
      JSON.parse(Buffer.from(first.cursor, 'base64url').toString('utf8')),
    ).toMatchObject({ after: { byteOffset: '65537' } });

    await searchHandlers['fs.grep']!(session, {
      ...BASE,
      cursor: first.cursor,
    });
    expect(requests[1]?.after).toMatchObject({
      path: 'large.txt',
      line: 12,
      byteOffset: 65_537n,
    });
  });

  it('reports a stopped point as unfinished and mints a resumable cursor', async () => {
    const { session } = sessionFor([
      [ended(SearchStop.FILES, { path: 'pending.txt', line: 0 }, 0)],
    ]);

    const result = await searchHandlers['fs.grep']!(session, BASE);
    expect(result).toMatchObject({
      ok: true,
      complete: false,
      unfinished: 'pending.txt',
      progressed: false,
      consumed: { files: 0, entries: 0, bytes: 40 },
    });

    if (!('ok' in result) || !result.ok || result.cursor === undefined)
      throw new Error('Expected an unfinished search cursor.');
    // SAFETY: the handler emitted this cursor from the supplied end position.
    expect(
      JSON.parse(Buffer.from(result.cursor, 'base64url').toString('utf8')),
    ).toMatchObject({
      after: { path: 'pending.txt', line: 0 },
    });
  });

  it('rejects a cursor bound to different search inputs without opening a stream', async () => {
    const { session, requests } = sessionFor([]);

    const result = await searchHandlers['fs.grep']!(session, {
      ...BASE,
      cursor: Buffer.from(
        JSON.stringify({
          after: { path: 'a.ts', line: 1 },
          inputHash: 'wrong',
        }),
      ).toString('base64url'),
    });

    expect(result).toMatchObject({ status: 'error', type: 'invalid_input' });
    expect(requests).toHaveLength(0);
  });
});
