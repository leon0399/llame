import { SearchStop, SkipReason, type SearchFilesRequest, type SearchFilesResponse } from '@workspace/machine-protocol';
import type { MachineSession } from '../machine-session.js';
import { searchHandlers } from './search.js';

const BASE = {
  envelope: { budgetMs: 10_000 },
  path: '/repo',
  globSuffix: '**',
  patterns: ['needle'],
  literal: true,
  ignoreCase: false,
  bounds: { files: null, entries: null, bytes: null, fileBytes: null, deadlineMs: 10_000, limit: 100, pageUnits: 180, progressed: false },
} as const;

function match(path: string, line: number, text: string): SearchFilesResponse {
  return { event: { case: 'match', value: { path, line, lines: [{ number: line, text, spans: [{ start: 0, end: 6 }] }] } } } as SearchFilesResponse;
}

function skipped(path: string, reason: SkipReason): SearchFilesResponse {
  return { event: { case: 'skipped', value: { path, reason } } } as SearchFilesResponse;
}

function ended(stop = SearchStop.COMPLETE, position?: { path: string; line: number }, files = 2): SearchFilesResponse {
  return { event: { case: 'end', value: { stop, ...(position && { position }), files, bytes: 40n, matches: 2 } } } as SearchFilesResponse;
}

function sessionFor(streams: SearchFilesResponse[][], requests: SearchFilesRequest[] = []) {
  let call = 0;
  const fake = {
    clients: { files: { searchFiles: (request: SearchFilesRequest) => {
      requests.push(request);
      const events = streams[call++] ?? [];
      return (async function* () { yield* events; })();
    } } },
    callOptions: () => ({}),
  };
  return { session: fake as unknown as MachineSession, requests };
}

describe('wire fs.grep', () => {
  it('merges overlapping context, returns warning and consumed counters', async () => {
    const { session } = sessionFor([[
      match('src/a.ts', 2, 'needle one'),
      { event: { case: 'match', value: { path: 'src/a.ts', line: 5, lines: [{ number: 2, text: 'needle one', spans: [{ start: 0, end: 6 }] }, { number: 3, text: 'middle', spans: [] }, { number: 4, text: 'middle two', spans: [] }, { number: 5, text: 'needle two', spans: [{ start: 0, end: 6 }] }] } } } as SearchFilesResponse,
      skipped('.git', SkipReason.IGNORED),
      skipped('bad.bin', SkipReason.BINARY),
      ended(),
    ]]);

    const result = await searchHandlers['fs.grep']!(session, { ...BASE, bounds: { ...BASE.bounds, pageUnits: 1000 } });
    expect(result).toMatchObject({
      ok: true,
      complete: true,
      warnings: [{ kind: 'binary', count: 1 }],
      consumed: { files: 2, entries: 2, bytes: 40 },
      ignored: { paths: ['.git'], atLeast: false },
      results: [{ path: 'src/a.ts', startLine: 2, endLine: 5, matches: [2, 5], content: '2: needle one\n3: middle\n4: middle two\n5: needle two' }],
    });
  });

  it('mints an input-bound cursor and resumes the second page at the hub position', async () => {
    const { session, requests } = sessionFor([
      [match('a.ts', 1, 'needle first'), match('b.ts', 1, 'needle second'), ended()],
      [match('b.ts', 1, 'needle second'), ended()],
    ]);
    const first = await searchHandlers['fs.grep']!(session, BASE);
    expect(first).toMatchObject({ ok: true, complete: false, results: [{ path: 'a.ts' }] });
    if (!('ok' in first) || !first.ok || first.cursor === undefined) throw new Error('Expected a continuation cursor.');
    expect(first.results[0]?.cut).toBe(true);
    const decoded = JSON.parse(Buffer.from(first.cursor, 'base64url').toString('utf8')) as { after: { path: string; line: number }; inputHash: string };
    expect(decoded.inputHash).toContain('/repo');

    const second = await searchHandlers['fs.grep']!(session, { ...BASE, cursor: first.cursor });
    expect(requests[1]?.after).toMatchObject({ path: 'a.ts', line: 1 });
    expect(second).toMatchObject({ ok: true, complete: true, results: [{ path: 'b.ts' }] });
  });
  it('caps passages per file at twenty and marks the twentieth', async () => {
    const events = Array.from({ length: 21 }, (_, index) => match('many.txt', index * 5 + 1, 'needle'));
    const { session } = sessionFor([[...events, ended()]]);
    const result = await searchHandlers['fs.grep']!(session, { ...BASE, bounds: { ...BASE.bounds, pageUnits: 10_000 } });
    expect(result).toMatchObject({ ok: true, complete: true, results: { length: 20 } });
    if (!('ok' in result) || !result.ok) throw new Error('Expected successful grep results.');
    expect(result.results[19]).toMatchObject({ capped: true });
  });
  it('reports a stopped point as unfinished and mints a resumable cursor', async () => {
    const { session } = sessionFor([[ended(SearchStop.FILES, { path: 'pending.txt', line: 0 }, 0)]]);
    const result = await searchHandlers['fs.grep']!(session, BASE);
    expect(result).toMatchObject({ ok: true, complete: false, unfinished: 'pending.txt', progressed: false, consumed: { files: 0, entries: 0, bytes: 40 } });
    if (!('ok' in result) || !result.ok || result.cursor === undefined) throw new Error('Expected an unfinished search cursor.');
    expect(JSON.parse(Buffer.from(result.cursor, 'base64url').toString('utf8'))).toMatchObject({
      after: { path: 'pending.txt', line: 0 },
    });
  });

  it('rejects a cursor bound to different search inputs without opening a stream', async () => {
    const { session, requests } = sessionFor([]);
    const result = await searchHandlers['fs.grep']!(session, { ...BASE, cursor: Buffer.from(JSON.stringify({ after: { path: 'a.ts', line: 1 }, inputHash: 'wrong' })).toString('base64url') });
    expect(result).toMatchObject({ status: 'error', type: 'invalid_input' });
    expect(requests).toHaveLength(0);
  });
});
