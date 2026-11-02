import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';

import {
  fsGrepCursorKey,
  isSerializableRecord,
  PATH_NOT_REGISTERED_MESSAGE,
  type SerializableRecord,
  type FsGrepPassage,
  type FsGrepSuccess,
  type JsonValue,
} from '@workspace/machine-protocol';
import {
  encodeGrepCursor,
  grepContinuationUnits,
  grepPassageUnits,
  grepWarningsUnits,
  hashGrepInputs,
  measureGrepRendering,
  renderGrepText,
  type GrepBudget,
} from '@workspace/native-file-tools';
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  KnowledgeFilesystemAdapter,
  type KnowledgeFilesystemBinding,
} from '../knowledge/knowledge-filesystem';
import { MachineConnector } from '../machines/machine-connector.service';
import { type MachineStatusView } from '../machines/machines-status';
import {
  createProtocolPeer,
  type PeerAnswer,
  type PeerCall,
  type ProtocolPeerOptions,
} from '../testing/machine-protocol-peer';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { grepInputSchema, nativeGrepTool, pageFixedReserve } from './grep';
import { createGrepReadAdmission, projectGrepScope } from './grep-admission';
import { executeMachineScope, type MachineGrepSearch } from './grep-machine';
import { machineNotFoundResult } from './machine-call';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { type ToolPermissionMap } from './permissions/types';
import {
  type KnowledgeToolResolver,
  type ToolContext,
  type ToolResult,
} from './types';
import { createWorkspaceRootCell } from './workspace-path';

const MACHINES = {
  ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
  hosts: { devl: { destination: 'box' } },
};

const STATUS: ReadonlyArray<MachineStatusView> = [];

/** The engine budget the hub hands a segment; a request mirrors it as bounds. */
const BUDGET: GrepBudget = {
  files: 5000,
  entries: 20_000,
  bytes: 32 * 1024 * 1024,
  // No file-size bound unless the operator sets `maxFileBytes`.
  maxFileBytes: null,
  deadlineMs: 30_000,
  limit: 20,
  pageUnits: 15_000,
  // The hub's own result fields travel outside the daemon's page.
  fixedReserve: 0,
};

/** Room the hub keeps for the deadline line it may add when the call ends. */
const DEADLINE_UNITS = grepWarningsUnits(new Map([['deadline', 1]]));

type Fixture = {
  readonly connector: MachineConnector;
  readonly peer: ReturnType<typeof createProtocolPeer>;
};

/** A glob-free scope probes its exact path; the default fixture walks it. */
const DIRECTORY_STAT: PeerAnswer = {
  value: { kind: 'directory', isLink: false },
};

function fixture(options: ProtocolPeerOptions = {}): Fixture {
  const peer = createProtocolPeer({
    ...options,
    answers: { 'fs.stat': DIRECTORY_STAT, ...options.answers },
  });
  const connector = new MachineConnector({
    machines: MACHINES,
    hubVersion: '9.9.9',
    transportFactory: peer.factory,
    handshakeTimeoutMs: 2000,
  });
  return { peer, connector };
}

function context(
  connector: MachineConnector,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  const db: Db = drizzle.mock({ schema });
  return {
    userId: 'owner',
    chatId: 'chat',
    runId: 'run',
    nativeDeliverySequence: 1,
    toolCallId: 'call',
    // The runner's per-call deadline: 35 s less the 5 s margin is the 30 s
    // walk these request shapes assert. A frozen clock keeps them exact.
    timeoutMs: 35_000,
    permissionPolicy: compileTestPermissionPolicy(['grep']),
    tenantDb: {
      runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    },
    machines: connector,
    machineStatus: { list: () => Promise.resolve(STATUS) },
    machineAttemptKey: 'attempt-1',
    // The operator bounds these tests' budget mirrors; an override replaces
    // the whole object, so a test can unset every bound.
    grepBounds: {
      maxFilesExamined: 5000,
      maxEntriesListed: 20_000,
      maxBytesRead: 32 * 1024 * 1024,
      maxFileBytes: null,
    },
    ...overrides,
  };
}

function run(contextOf: ToolContext, args: unknown) {
  const parsed = grepInputSchema.safeParse(args);
  if (!parsed.success) throw new Error('the fixture arguments must parse');
  return nativeGrepTool.execute(contextOf, parsed.data);
}

function passage(
  path: string,
  startLine: number,
  endLine: number,
  matches: ReadonlyArray<number> = [startLine],
): FsGrepPassage {
  return {
    path,
    startLine,
    endLine,
    content: `${String(startLine)}: needle`,
    matches,
  };
}

function page(
  results: ReadonlyArray<FsGrepPassage>,
  overrides: Partial<FsGrepSuccess> = {},
): FsGrepSuccess {
  return {
    ok: true,
    results,
    complete: true,
    warnings: [],
    consumed: { files: results.length, entries: results.length, bytes: 0 },
    progressed: false,
    ...overrides,
  };
}

function success(result: ToolResult) {
  if (result.status !== 'success')
    throw new Error(`expected success, received ${result.type}`);
  return result;
}

function locatorsOf(result: ToolResult): ReadonlyArray<string> {
  const results = success(result).results;
  if (!Array.isArray(results)) return [];
  return results.map((entry) => {
    if (!isRecord(entry) || !isString(entry['locator']))
      throw new Error('a passage carries a locator');
    return entry['locator'];
  });
}

/** The excluded-directory report of a successful result, when it carries one. */
function ignoredOf(result: ToolResult):
  | {
      readonly count: number;
      readonly locators: ReadonlyArray<string>;
      readonly atLeast: boolean;
    }
  | undefined {
  const ignored = success(result)['ignored'];
  if (!isRecord(ignored)) return undefined;
  const { count, locators, atLeast } = ignored;
  if (!isNumber(count) || !Array.isArray(locators)) return undefined;
  if (!locators.every(isString)) return undefined;
  return { count, locators, atLeast: atLeast === true };
}

/** Every string a result carries, wherever it nests. */
function stringsOf(value: unknown, found: Array<string> = []): Array<string> {
  if (isString(value)) {
    found.push(value);
    return found;
  }
  if (Array.isArray(value)) {
    for (const entry of value) stringsOf(entry, found);
    return found;
  }
  if (isRecord(value)) {
    for (const entry of Object.values(value)) stringsOf(entry, found);
    return found;
  }
  return found;
}

/** The decoded payload of an opaque grep cursor, which a test may read. */
function cursorPayloadOf(result: ToolResult): SerializableRecord {
  const cursor = success(result)['cursor'];
  if (!isString(cursor)) throw new Error('the page carries a cursor');
  const payload: unknown = JSON.parse(
    Buffer.from(cursor, 'base64url').toString('utf8'),
  );
  if (!isSerializableRecord(payload))
    throw new Error('the cursor is an object');
  return payload;
}

/** The passage an opaque grep cursor names, which a test may read. */
function cursorPointOf(result: ToolResult) {
  const { rel, startLine } = cursorPayloadOf(result);
  if (!isString(rel) || !isNumber(startLine))
    throw new Error('the cursor names a passage');
  return { rel, startLine };
}

/** The hash `grep.ts` binds a call's cursor to, for the scopes it submitted. */
function hashOfScopes(
  scopes: ReadonlyArray<string>,
  roots: ReadonlyArray<string>,
): string {
  return hashGrepInputs({
    patterns: ['needle'],
    literal: false,
    ignoreCase: false,
    projectedScopes: scopes.map(
      (scope) => projectGrepScope(scope, undefined).prefix,
    ),
    resolvedRoots: roots,
  });
}

function readingRejects(rejectPath: string): ToolPermissionMap {
  return {
    grep: { allow: true },
    read: {
      allow: true,
      reject: [{ field: 'path', literal: rejectPath }],
    },
  };
}

describe('Machine grep', () => {
  it('runs the walk on the Machine and reports Machine locators', async () => {
    const { peer, connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([
            passage('a.go', 1, 2, [2]),
            passage('nested/c.go', 1, 1),
          ]),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**/*.go'],
    });
    expect(locatorsOf(result)).toEqual([
      'machine://devl/srv/app/a.go:1-2',
      'machine://devl/srv/app/nested/c.go:1-1',
    ]);
    const session = await peer.session(0);
    expect(session.calls).toHaveLength(1);
    expect(session.calls[0].method).toBe('fs.grep');
    expect(session.calls[0].params).toMatchObject({
      path: '/srv/app',
      globSuffix: '**/*.go',
      patterns: ['needle'],
      literal: false,
      ignoreCase: false,
      bounds: {
        files: BUDGET.files,
        entries: BUDGET.entries,
        bytes: BUDGET.bytes,
        fileBytes: null,
        limit: BUDGET.limit,
      },
    });
  });

  it('carries no bare host path in any result field', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': { value: page([passage('a.go', 1, 2, [2])]) },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**/*.go'],
    });
    for (const text of stringsOf(result)) {
      expect(text.startsWith('/')).toBe(false);
      if (text.includes('/srv/app')) expect(text).toContain('machine://devl');
    }
  });

  it('refuses a Machine path outside the registered roots', async () => {
    const { connector } = fixture({
      answers: { 'fs.grep': { error: 'path_not_registered' } },
    });
    expect(
      await run(context(connector), {
        patterns: ['needle'],
        scopes: ['machine://devl/**'],
      }),
    ).toMatchObject({
      status: 'error',
      type: 'path_not_registered',
      message: PATH_NOT_REGISTERED_MESSAGE,
    });
  });

  it('fails an unknown Machine without searching another scope', async () => {
    const { peer, connector } = fixture();
    expect(
      await run(context(connector), {
        patterns: ['needle'],
        scopes: ['machine://nope/srv/app/**', 'machine://devl/srv/app/**'],
      }),
    ).toMatchObject({ status: 'error', type: 'machine_not_found' });
    expect(peer.sessions).toHaveLength(0);
  });

  it('fails as Machine unusable when the daemon has no such method', async () => {
    const { connector } = fixture();
    expect(
      await run(context(connector), {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/app/**'],
      }),
    ).toMatchObject({ status: 'error', type: 'machine_protocol_error' });
  });

  it('refuses an answer that names a path outside the prefix', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': { value: page([passage('../../etc/passwd', 1, 1)]) },
      },
    });
    expect(
      await run(context(connector), {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/app/**'],
      }),
    ).toMatchObject({ status: 'error', type: 'machine_protocol_error' });
  });

  it('carries the remaining byte bound to a second Machine scope', async () => {
    const { peer, connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([], {
            consumed: { files: 1, entries: 1, bytes: 30 * 1024 * 1024 },
          }),
        },
      },
    });
    const result = await run(
      context(connector, {
        grepBounds: {
          maxFilesExamined: null,
          maxEntriesListed: null,
          maxBytesRead: 32 * 1024 * 1024,
          maxFileBytes: null,
        },
      }),
      {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
      },
    );
    expect(result.status).toBe('success');
    const session = await peer.session(0);
    expect(session.calls).toHaveLength(2);
    expect(session.calls[1].params).toMatchObject({
      path: '/srv/b',
      bounds: {
        bytes: 2 * 1024 * 1024,
        files: null,
        entries: null,
        fileBytes: null,
      },
    });
  });

  it('travels an unset bound as null', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.grep': { value: page([passage('a.go', 1, 1)]) } },
    });
    await run(context(connector, { grepBounds: undefined }), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/**'],
    });
    const session = await peer.session(0);
    expect(session.calls[0].params).toMatchObject({
      bounds: {
        files: null,
        entries: null,
        bytes: null,
        fileBytes: null,
      },
    });
  });

  it('fails as Machine unusable when the daemon refuses the request shape', async () => {
    const { connector } = fixture({
      answers: { 'fs.grep': { error: 'invalid_params' } },
    });
    expect(
      await run(context(connector), {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/app/**'],
      }),
    ).toMatchObject({
      status: 'error',
      type: 'machine_protocol_error',
    });
  });

  it('carries the configured file-size bound to the daemon', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.grep': { value: page([]) } },
    });
    await run(
      context(connector, {
        grepBounds: {
          maxFilesExamined: null,
          maxEntriesListed: null,
          maxBytesRead: null,
          maxFileBytes: 1024,
        },
      }),
      { patterns: ['needle'], scopes: ['machine://devl/srv/app/**'] },
    );
    const session = await peer.session(0);
    expect(session.calls[0].params).toMatchObject({
      bounds: { fileBytes: 1024 },
    });
  });

  it('always carries the deadline warning on a page filled to the bound', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(0);
      const rel = 'a.go';
      const locator = 'machine://devl/srv/a/a.go:1-1';
      // Fill the page to its new bound: the passage, the cursor's continuation
      // line, the hub's own lines, and the deadline line it reserves up front.
      const room =
        15_000 -
        pageFixedReserve() -
        grepContinuationUnits({ scopeIndex: 0, rel, startLine: 1 }) -
        grepWarningsUnits(new Map([['deadline', 1]])) -
        grepPassageUnits(undefined, { locator, content: '1: ', matches: [1] });
      const filled = {
        ...passage(rel, 1, 1),
        content: `1: ${'x'.repeat(room)}`,
        matches: [1],
      };
      const { connector } = fixture({
        answer: (call) => {
          if (call.method !== 'fs.grep') return undefined;
          // The answer spends the rest of the walk.
          vi.setSystemTime(109_000);
          return { value: page([filled]) };
        },
      });
      const result = await run(
        context(connector, { timeoutMs: undefined, callTimeoutSeconds: 120 }),
        {
          patterns: ['needle'],
          scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
        },
      );
      expect(locatorsOf(result)).toEqual([locator]);
      expect(success(result).complete).toBe(false);
      // The spec requires this warning at the call deadline, so it is never
      // dropped to keep the page inside its bound.
      expect(success(result).warnings).toEqual([
        { kind: 'deadline', count: 1 },
      ]);
      expect(measureGrepRendering(result)).toBeLessThanOrEqual(15_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a passage that leaves no room for the deadline line', async () => {
    // The same page filled without keeping the deadline line's room: the hub
    // admits no entry there, so the warning it must report always fits.
    const rel = 'a.go';
    const locator = 'machine://devl/srv/a/a.go:1-1';
    const room =
      15_000 -
      pageFixedReserve() -
      grepContinuationUnits({ scopeIndex: 0, rel, startLine: 1 }) -
      grepPassageUnits(undefined, { locator, content: '1: ', matches: [1] });
    const oversized = {
      ...passage(rel, 1, 1),
      content: `1: ${'x'.repeat(room)}`,
      matches: [1],
    };
    const { connector } = fixture({
      answer: (call) =>
        call.method === 'fs.grep' ? { value: page([oversized]) } : undefined,
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/a/**'],
    });
    expect(locatorsOf(result)).toEqual([]);
    expect(success(result).complete).toBe(false);
    expect(measureGrepRendering(result)).toBeLessThanOrEqual(15_000);
  });

  it('reserves the accumulated warnings line on a second daemon page', async () => {
    const scope = 'machine://devl/srv/app/**';
    let searches = 0;
    const { peer, connector } = fixture({
      answer: (call) => {
        if (call.method !== 'fs.grep') return undefined;
        searches += 1;
        return {
          value:
            searches === 1
              ? page([], {
                  complete: false,
                  cursor: 'daemon-next',
                  warnings: [{ kind: 'binary', count: 5 }],
                  consumed: { files: 1, entries: 1, bytes: 10 },
                })
              : page([passage('b.go', 1, 1)]),
        };
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: [scope],
    });
    expect(result).toMatchObject({ status: 'success' });
    const asked = (await peer.session(0)).calls.filter(
      (call) => call.method === 'fs.grep',
    );
    expect(asked).toHaveLength(2);
    // 14,836 = 15,000 less the hub's own lines (120), the deadline line it
    // reserves (23), and the first page's `[warnings: 5 binary]` line (21), so
    // the second page's passage survives instead of being dropped for room.
    expect(boundsOf(asked[1]?.params)).toMatchObject({ pageUnits: 14_836 });
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/b.go:1-1']);
    expect(success(result).complete).toBe(true);
  });

  it('never names a refused passage in the cursor', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([passage('a.go', 1, 1), passage('b.go', 4, 4)], {
            complete: false,
            cursor: 'daemon-cursor',
          }),
        },
      },
    });
    const result = await run(
      context(connector, {
        permissionPolicy: compileToolPermissionMap(
          readingRejects('machine://devl/srv/app/b.go'),
          'test',
        ),
      }),
      { patterns: ['needle'], scopes: ['machine://devl/srv/app/**'] },
    );
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/a.go:1-1']);
    expect(cursorPointOf(result)).toEqual({ rel: 'a.go', startLine: 1 });
    expect(JSON.stringify(result)).not.toContain('b.go');
  });

  it('resumes a Machine scope from the cursor the API issued', async () => {
    const scope = 'machine://devl/srv/app/**';
    const apiCursor = encodeGrepCursor({
      scopeIndex: 0,
      rel: 'a.go',
      startLine: 1,
      inputHash: hashOfScopes([scope], ['devl']),
    });
    const daemonCursor = encodeGrepCursor({
      scopeIndex: 0,
      rel: 'a.go',
      startLine: 1,
      inputHash: fsGrepCursorKey({
        path: '/srv/app',
        globSuffix: '**',
        patterns: ['needle'],
        literal: false,
        ignoreCase: false,
      }),
    });
    const { peer, connector } = fixture({
      answers: { 'fs.grep': { value: page([passage('b.go', 1, 1)]) } },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: [scope],
      cursor: apiCursor,
    });
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/b.go:1-1']);
    const session = await peer.session(0);
    expect(session.calls[0].params).toMatchObject({ cursor: daemonCursor });
  });

  it('maps a host scope inside a Machine Workspace to the Machine', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.grep': { value: page([passage('a.ts', 1, 1)]) } },
    });
    const result = await run(
      context(connector, {
        workspaceRoot: createWorkspaceRootCell('machine://devl/home/me/shop'),
      }),
      { patterns: ['needle'], scopes: ['/home/me/shop/src/**'] },
    );
    expect(locatorsOf(result)).toEqual([
      'machine://devl/home/me/shop/src/a.ts:1-1',
    ]);
    const session = await peer.session(0);
    expect(session.calls[0].params).toMatchObject({
      path: '/home/me/shop/src',
    });
  });
});

/** The bounds one request carried, as the peer received it. */
function boundsOf(params: JsonValue | undefined): SerializableRecord {
  if (!isSerializableRecord(params))
    throw new Error('the request carries params');
  const bounds = params['bounds'];
  if (!isSerializableRecord(bounds))
    throw new Error('the request carries bounds');
  return bounds;
}

function passagesOf(result: ToolResult): ReadonlyArray<SerializableRecord> {
  const results = success(result).results;
  if (!Array.isArray(results)) return [];
  return results.map((entry) => {
    if (!isSerializableRecord(entry)) throw new Error('a passage is a record');
    return entry;
  });
}

function warningsOf(result: ToolResult): ReadonlyArray<unknown> {
  const warnings = success(result)['warnings'];
  return Array.isArray(warnings) ? warnings : [];
}

/** Answer each `fs.grep` from the Machine path it names. */
function answeredByPath(
  byPath: Readonly<Record<string, FsGrepSuccess>>,
): (call: PeerCall) => { readonly value: JsonValue } | undefined {
  return (call) => {
    const params = call.params;
    if (!isRecord(params) || !isString(params['path'])) return undefined;
    const answer = byPath[params['path']];
    return answer === undefined ? undefined : { value: answer };
  };
}

/** Content whose rendered passage takes exactly `units` code units. */
function contentOfUnits(
  locator: string,
  units: number,
  matches: ReadonlyArray<number> = [1],
): string {
  // A page of this one passage renders its file line and then the content
  // line after one newline, so the content fills what those leave.
  const bare = measureGrepRendering({
    results: [{ locator, content: '', matches }],
    complete: true,
  });
  return 'a'.repeat(units - bare - 1);
}

function locatorAt(name: string, startLine: number, endLine: number): string {
  return `machine://devl/srv/app/${name}:${String(startLine)}-${String(endLine)}`;
}

const SPACE_ID = '11111111-1111-4111-8111-111111111111';

/** One Knowledge Space with one matching note, for mixed-scope tests. */
async function withNoteSpace<T>(
  callback: (resolver: KnowledgeToolResolver) => Promise<T>,
): Promise<T> {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), 'llame-grep-machine-')),
  );
  try {
    const directory = path.join(root, SPACE_ID);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'a.md'), 'needle\n');
    const binding: KnowledgeFilesystemBinding = {
      id: SPACE_ID,
      name: 'notes',
      root,
      directory,
    };
    return await callback({
      listForOwnerPage: () =>
        Promise.resolve({
          spaces: [{ id: SPACE_ID, name: 'notes', createdAt: new Date(0) }],
        }),
      resolveBindingForOwnerById: (_owner, id) =>
        Promise.resolve(id === SPACE_ID ? binding : undefined),
      createAdapter: (adapter) => new KnowledgeFilesystemAdapter(adapter),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('Machine scope addresses', () => {
  it('answers not_found for a glob-free file the read group refuses', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.stat': { value: { kind: 'file', isLink: false } } },
    });
    const result = await run(
      context(connector, {
        permissionPolicy: compileToolPermissionMap(
          readingRejects('machine://devl/srv/app/a.go'),
          'test',
        ),
      }),
      { patterns: ['needle'], scopes: ['machine://devl/srv/app/a.go'] },
    );
    expect(result).toEqual({
      status: 'error',
      type: 'not_found',
      message: 'The target does not exist.',
    });
    // The probe settled it; the daemon never searched the file.
    const session = await peer.session(0);
    expect(session.calls.map((call) => call.method)).toEqual(['fs.stat']);
  });

  it('walks a glob-free directory the read group refuses as a path', async () => {
    const { connector } = fixture({
      answers: { 'fs.grep': { value: page([passage('a.go', 1, 1)]) } },
    });
    const result = await run(
      context(connector, {
        permissionPolicy: compileToolPermissionMap(
          {
            grep: { allow: true },
            read: {
              allow: true,
              // The directory path alone, not the files below it.
              reject: [
                {
                  field: 'path',
                  regex: '^machine://devl/srv/app$',
                },
              ],
            },
          },
          'test',
        ),
      }),
      { patterns: ['needle'], scopes: ['machine://devl/srv/app'] },
    );
    // Only the exact-path rule is a directory's business: its files are
    // judged one by one, so the directory itself is never a refused file.
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/a.go:1-1']);
  });

  it('refuses a scope that names no path', async () => {
    const { connector } = fixture();
    expect(
      await run(context(connector), {
        patterns: ['needle'],
        scopes: ['machine://devl'],
      }),
    ).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'A machine:// scope must name a Machine and an absolute path.',
    });
  });

  it('refuses a scope with an empty Machine name', async () => {
    const { connector } = fixture();
    expect(
      await run(context(connector), {
        patterns: ['needle'],
        scopes: ['machine:///srv/app'],
      }),
    ).toEqual({
      status: 'error',
      type: 'invalid_path',
      message:
        'A machine:// scope must name a Machine as [a-z0-9-], up to 63 characters.',
    });
  });

  it('refuses a Machine name outside the configuration grammar', async () => {
    const { peer, connector } = fixture();
    expect(
      await run(context(connector), {
        patterns: ['needle'],
        scopes: ['machine://bad_name/srv/app'],
      }),
    ).toEqual({
      status: 'error',
      type: 'invalid_path',
      message:
        'A machine:// scope must name a Machine as [a-z0-9-], up to 63 characters.',
    });
    expect(peer.sessions).toHaveLength(0);
  });

  it('searches the submitted path without adding a separator', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.grep': { value: page([passage('a.go', 1, 1)]) } },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app'],
    });
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/a.go:1-1']);
    const session = await peer.session(0);
    expect(session.calls[0].params).toMatchObject({ path: '/srv/app' });
  });

  it('renders a passage of the Machine root with one separator', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.grep': { value: page([passage('a.go', 1, 1)]) } },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/'],
    });
    expect(locatorsOf(result)).toEqual(['machine://devl/a.go:1-1']);
    const session = await peer.session(0);
    expect(session.calls[0].params).toMatchObject({ path: '/' });
  });

  it('renders the searched scope itself without a trailing separator', async () => {
    const { connector } = fixture({
      answers: { 'fs.grep': { value: page([passage('', 1, 1)]) } },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app'],
    });
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app:1-1']);
  });

  it('names the Machine surface this process lacks', async () => {
    const disabled = new MachineConnector({
      machines: undefined,
      hubVersion: 'test',
      onContact: () => undefined,
    });
    expect(
      await run(context(disabled), {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/app/**'],
      }),
    ).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'Machine locators are not available on this process.',
    });
  });

  it('reports an unconfigured Machine without reaching it', async () => {
    const { peer, connector } = fixture();
    const contextOf = context(connector);
    expect(
      await executeMachineScope({
        context: contextOf,
        scope: {
          index: 0,
          name: 'nope',
          path: '/srv/app',
          globSuffix: undefined,
        },
        args: { patterns: ['needle'], literal: false, ignoreCase: false },
        budget: BUDGET,
        resume: undefined,
        progressed: false,
        admission: createGrepReadAdmission(contextOf),
      }),
    ).toEqual({ status: 'error', result: machineNotFoundResult('nope') });
    expect(peer.sessions).toHaveLength(0);
  });

  it('cancels a request whose call was aborted before it left', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.grep': { value: page([]) } },
    });
    const controller = new AbortController();
    controller.abort();
    const contextOf = context(connector, { abortSignal: controller.signal });
    const search: MachineGrepSearch = {
      context: contextOf,
      scope: {
        index: 0,
        name: 'devl',
        path: '/srv/app',
        globSuffix: undefined,
      },
      args: { patterns: ['needle'], literal: false, ignoreCase: false },
      budget: BUDGET,
      resume: undefined,
      progressed: false,
      admission: createGrepReadAdmission(contextOf),
    };
    await expect(executeMachineScope(search)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(peer.sessions).toHaveLength(0);
  });
});

describe('Machine request shape', () => {
  it('carries the compiled flags and the call deadline', async () => {
    // The budget is the deadline minus the clock at send time; a frozen clock
    // keeps a slow runner from shaving milliseconds off the expected value.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { peer, connector } = fixture({
        answers: { 'fs.grep': { value: page([]) } },
      });
      await run(context(connector), {
        patterns: ['needle'],
        literal: true,
        ignoreCase: true,
        scopes: ['machine://devl/srv/app'],
      });
      const session = await peer.session(0);
      const search = session.calls.find((call) => call.method === 'fs.grep');
      expect(search?.params).toMatchObject({
        literal: true,
        ignoreCase: true,
        envelope: { budgetMs: 30_000 },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks a later scope with the progress of the earlier one', async () => {
    const { peer, connector } = fixture({
      answer: (call) => {
        if (call.method !== 'fs.grep') return undefined;
        const answered = isSerializableRecord(call.params)
          ? call.params['path']
          : undefined;
        return {
          value:
            answered === '/srv/a'
              ? page([passage('a.go', 1, 1)], { progressed: true })
              : page([passage('b.go', 1, 1)], { progressed: false }),
        };
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
    });
    expect(locatorsOf(result)).toEqual([
      'machine://devl/srv/a/a.go:1-1',
      'machine://devl/srv/b/b.go:1-1',
    ]);
    const asked = (await peer.session(0)).calls.filter(
      (call) => call.method === 'fs.grep',
    );
    expect(asked).toHaveLength(2);
    // The first scope's passage progressed the call, so the second request
    // says so and its own stop would hide no file behind it.
    expect(boundsOf(asked[0].params)['progressed']).toBe(false);
    expect(boundsOf(asked[1].params)['progressed']).toBe(true);
  });

  it('gives the daemon nine tenths of the time left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { peer, connector } = fixture({
        answers: { 'fs.grep': { value: page([passage('a.go', 1, 1)]) } },
      });
      const result = await run(context(connector), {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/app/**'],
      });
      // The daemon that spends its whole budget still answers, so its page,
      // cursor, and unfinished file are never lost to the hub's abandon.
      expect(result).toMatchObject({ status: 'success', complete: true });
      expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/a.go:1-1']);
      const session = await peer.session(0);
      const search = session.calls.find((call) => call.method === 'fs.grep');
      expect(search?.params).toMatchObject({
        envelope: { budgetMs: 30_000 },
        bounds: { deadlineMs: 27_000 },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks the next page with the progress of the pages before it', async () => {
    const scope = 'machine://devl/srv/app/**';
    let searches = 0;
    const { peer, connector } = fixture({
      answer: (call) => {
        if (call.method !== 'fs.grep') return undefined;
        searches += 1;
        return {
          value:
            searches === 1
              ? page([passage('hidden.go', 1, 1)], {
                  complete: false,
                  progressed: true,
                  cursor: 'daemon-next',
                  consumed: { files: 1, entries: 1, bytes: 10 },
                })
              : searches === 2
                ? page([], {
                    complete: false,
                    progressed: false,
                    cursor: 'daemon-third',
                    consumed: { files: 1, entries: 1, bytes: 10 },
                  })
                : page([passage('a.go', 1, 1)], { progressed: false }),
        };
      },
    });
    const result = await run(
      context(connector, {
        permissionPolicy: compileToolPermissionMap(
          readingRejects('machine://devl/srv/app/hidden.go'),
          'test',
        ),
      }),
      { patterns: ['needle'], scopes: [scope] },
    );
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/a.go:1-1']);
    const asked = (await peer.session(0)).calls.filter(
      (call) => call.method === 'fs.grep',
    );
    expect(asked).toHaveLength(3);
    // The call progressed in the first page, and a later page that reports
    // false cannot erase it: every following request says the call progressed.
    expect(boundsOf(asked[0].params)['progressed']).toBe(false);
    expect(boundsOf(asked[1].params)['progressed']).toBe(true);
    expect(boundsOf(asked[2].params)['progressed']).toBe(true);
    expect(success(result)['unfinishedFile']).toBeUndefined();
  });

  it('does not name an unfinished file the read group refuses', async () => {
    const scope = 'machine://devl/srv/app/**';
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([], {
            complete: false,
            progressed: false,
            unfinished: 'hidden.go',
            cursor: encodeGrepCursor({
              kind: 'position',
              scopeIndex: 0,
              rel: 'hidden.go',
              inputHash: fsGrepCursorKey({
                path: '/srv/app',
                globSuffix: '**',
                patterns: ['needle'],
                literal: false,
                ignoreCase: false,
              }),
            }),
          }),
        },
      },
    });
    const result = await run(
      context(connector, {
        permissionPolicy: compileToolPermissionMap(
          readingRejects('machine://devl/srv/app/hidden.go'),
          'test',
        ),
      }),
      { patterns: ['needle'], scopes: [scope] },
    );
    expect(Object.hasOwn(success(result), 'unfinishedFile')).toBe(false);
    // The file is never named, but the cursor still moves past it.
    expect(cursorPayloadOf(result)).toMatchObject({
      kind: 'position',
      scopeIndex: 0,
      rel: 'hidden.go',
    });
  });

  it('skips an unfinished single-file scope by its ordinal', async () => {
    const scope = 'machine://devl/var/log/huge.log';
    const { peer, connector } = fixture({
      answers: {
        'fs.stat': { value: { kind: 'file', isLink: false } },
        'fs.grep': {
          value: page([], {
            complete: false,
            progressed: false,
            unfinished: '',
            consumed: { files: 1, entries: 1, bytes: 10 },
            cursor: encodeGrepCursor({
              kind: 'position',
              scopeIndex: 1,
              rel: '',
              inputHash: fsGrepCursorKey({
                path: '/var/log/huge.log',
                patterns: ['needle'],
                literal: false,
                ignoreCase: false,
              }),
            }),
          }),
        },
      },
    });
    const contextOf = context(connector);
    const first = await run(contextOf, {
      patterns: ['needle'],
      scopes: [scope],
    });
    expect(success(first)).toMatchObject({
      complete: false,
      unfinishedFile: 'machine://devl/var/log/huge.log',
    });
    const cursor = cursorPayloadOf(first);
    expect(cursor).toMatchObject({ kind: 'position', scopeIndex: 1, rel: '' });
    const opaque = success(first)['cursor'];
    if (!isString(opaque)) throw new Error('the page carries a cursor');

    // The next call names an ordinal past the only scope, so it asks the
    // daemon nothing and answers an empty, complete page.
    const second = await run(contextOf, {
      patterns: ['needle'],
      scopes: [scope],
      cursor: opaque,
    });
    expect(second).toMatchObject({ status: 'success', complete: true });
    expect(locatorsOf(second)).toEqual([]);
    const session = await peer.session(0);
    // The resumed call still probes the exact path, but it asks for no second
    // search: the cursor's ordinal is past the only scope.
    expect(session.calls.map((call) => call.method)).toEqual([
      'fs.stat',
      'fs.grep',
      'fs.stat',
    ]);
  });

  it('keeps each passage matches and its truncation flag', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([
            passage('a.go', 1, 2, [2]),
            { ...passage('b.go', 5, 5), truncated: true },
          ]),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    const [first, second] = passagesOf(result);
    expect(first?.['matches']).toEqual([2]);
    expect(Object.hasOwn(first ?? {}, 'truncated')).toBe(false);
    expect(second).toMatchObject({ truncated: true });
  });
});

describe('Machine page bounds', () => {
  it('hands a following scope exactly what the page left', async () => {
    const { peer, connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([passage('a.go', 1, 1), passage('a.go', 3, 3)], {
            consumed: { files: 1, entries: 2, bytes: 100 },
          }),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
    });
    expect(result).toMatchObject({ status: 'success', complete: true });
    const session = await peer.session(0);
    expect(session.calls).toHaveLength(2);
    // Both passages as the page renders them, plus the newline that separates
    // the next scope from them.
    const rendered =
      measureGrepRendering({
        results: [
          {
            locator: 'machine://devl/srv/a/a.go:1-1',
            content: '1: needle',
            matches: [1],
          },
          {
            locator: 'machine://devl/srv/a/a.go:3-3',
            content: '3: needle',
            matches: [3],
          },
        ],
        complete: true,
      }) + 1;
    expect(session.calls[1].params).toMatchObject({
      path: '/srv/b',
      bounds: {
        files: 4999,
        entries: 19_998,
        bytes: 32 * 1024 * 1024 - 100,
        limit: 19,
        pageUnits: 15_000 - rendered - pageFixedReserve() - DEADLINE_UNITS,
      },
    });
    const bounds = boundsOf(session.calls[1].params);
    expect(bounds['deadlineMs']).toBeGreaterThan(0);
    expect(bounds['deadlineMs']).toBeLessThanOrEqual(30_000);
  });

  it('keeps the separators of a page that holds one passage', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.grep': { value: page([passage('a.go', 1, 1)]) } },
    });
    await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
    });
    const session = await peer.session(0);
    const rendered = measureGrepRendering({
      results: [
        {
          locator: 'machine://devl/srv/a/a.go:1-1',
          content: '1: needle',
          matches: [1],
        },
      ],
      complete: true,
    });
    expect(boundsOf(session.calls[1].params)).toMatchObject({
      pageUnits: 15_000 - rendered - 1 - pageFixedReserve() - DEADLINE_UNITS,
    });
  });

  it('hands a following scope the whole page when it kept nothing', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.grep': { value: page([]) } },
    });
    await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
    });
    const session = await peer.session(0);
    expect(boundsOf(session.calls[1].params)).toMatchObject({
      pageUnits: 15_000 - pageFixedReserve() - DEADLINE_UNITS,
      limit: 20,
    });
  });

  it('keeps asking the daemon while every passage of a page is refused', async () => {
    const scope = 'machine://devl/srv/app/**';
    let searches = 0;
    const { peer, connector } = fixture({
      answer: (call) => {
        if (call.method !== 'fs.grep') return undefined;
        searches += 1;
        return {
          value:
            searches === 1
              ? page([passage('hidden.go', 1, 1)], {
                  complete: false,
                  cursor: 'daemon-next',
                  consumed: { files: 1, entries: 1, bytes: 10 },
                })
              : page([passage('a.go', 1, 1)]),
        };
      },
    });
    const result = await run(
      context(connector, {
        permissionPolicy: compileToolPermissionMap(
          readingRejects('machine://devl/srv/app/hidden.go'),
          'test',
        ),
      }),
      { patterns: ['needle'], scopes: [scope] },
    );
    // The refused page is not the page: the call keeps its budget and asks
    // for the next daemon page instead of ending without a passage.
    expect(result).toMatchObject({ status: 'success', complete: true });
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/a.go:1-1']);
    const session = await peer.session(0);
    const asked = session.calls.filter((call) => call.method === 'fs.grep');
    expect(asked).toHaveLength(2);
    expect(asked[1]?.params).toMatchObject({
      cursor: 'daemon-next',
      bounds: { files: 4999, entries: 19_999, bytes: 32 * 1024 * 1024 - 10 },
    });
    expect(JSON.stringify(result)).not.toContain('hidden.go');
  });

  it('resumes after the entry a page of refused passages stopped at', async () => {
    const scope = 'machine://devl/srv/app/**';
    const daemonCursor = encodeGrepCursor({
      kind: 'position',
      scopeIndex: 0,
      rel: 'hidden.go',
      inputHash: fsGrepCursorKey({
        path: '/srv/app',
        globSuffix: '**',
        patterns: ['needle'],
        literal: false,
        ignoreCase: false,
      }),
    });
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([passage('hidden.go', 1, 1)], {
            complete: false,
            cursor: daemonCursor,
            consumed: { files: 5000, entries: 1, bytes: 0 },
          }),
        },
      },
    });
    const result = await run(
      context(connector, {
        permissionPolicy: compileToolPermissionMap(
          readingRejects('machine://devl/srv/app/hidden.go'),
          'test',
        ),
      }),
      { patterns: ['needle'], scopes: [scope] },
    );
    expect(result).toMatchObject({ status: 'success', complete: false });
    expect(locatorsOf(result)).toEqual([]);
    // The file budget is spent, so the call stops: the cursor names the entry
    // the walk reached, never the passage the `read` group refused.
    expect(cursorPayloadOf(result)).toEqual({
      kind: 'position',
      scopeIndex: 0,
      rel: 'hidden.go',
      inputHash: hashOfScopes([scope], ['devl']),
    });
    expect(JSON.stringify(result)).not.toContain('hidden.go');
  });

  it('carries a passage cursor when a later scope only reached a refused entry', async () => {
    const scopes = ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'];
    const stopped = encodeGrepCursor({
      kind: 'position',
      scopeIndex: 0,
      rel: 'hidden.go',
      inputHash: fsGrepCursorKey({
        path: '/srv/b',
        globSuffix: '**',
        patterns: ['needle'],
        literal: false,
        ignoreCase: false,
      }),
    });
    const { connector } = fixture({
      answer: answeredByPath({
        '/srv/a': page([passage('a.go', 1, 1)]),
        // The second scope's only passage is refused and its file budget is
        // spent, so its own page stops at a position cursor.
        '/srv/b': page([passage('hidden.go', 1, 1)], {
          complete: false,
          cursor: stopped,
          consumed: { files: 5000, entries: 1, bytes: 0 },
        }),
      }),
    });
    const result = await run(
      context(connector, {
        permissionPolicy: compileToolPermissionMap(
          readingRejects('machine://devl/srv/b/hidden.go'),
          'test',
        ),
      }),
      { patterns: ['needle'], scopes },
    );
    expect(result).toMatchObject({ status: 'success', complete: false });
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/a/a.go:1-1']);
    // The page emitted a passage, so its cursor is that passage's; the second
    // scope's entry is reached again under the next call's own budget.
    expect(cursorPayloadOf(result)).toMatchObject({
      kind: 'passage',
      scopeIndex: 0,
      rel: 'a.go',
    });
    expect(JSON.stringify(result)).not.toContain('hidden.go');
  });

  it('stops after a scope whose page is incomplete', async () => {
    const { peer, connector } = fixture({
      answer: answeredByPath({
        '/srv/a': page([passage('a.go', 1, 1)], { complete: false }),
        '/srv/b': page([passage('b.go', 1, 1)]),
      }),
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
    });
    expect(result).toMatchObject({ status: 'success', complete: false });
    expect(success(result)['cursor']).toEqual(expect.any(String));
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/a/a.go:1-1']);
    const session = await peer.session(0);
    expect(session.calls).toHaveLength(1);
  });

  it('ends the file bound before asking the next scope', async () => {
    const { peer, connector } = fixture({
      answer: answeredByPath({
        '/srv/a': page([passage('a.go', 1, 1)]),
        '/srv/b': page([passage('b.go', 1, 1)]),
      }),
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      limit: 1,
      scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
    });
    expect(result).toMatchObject({ status: 'success', complete: false });
    expect(warningsOf(result)).toEqual([]);
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/a/a.go:1-1']);
    const session = await peer.session(0);
    expect(session.calls).toHaveLength(1);
  });

  it('ends the page when the call deadline expires and says why', async () => {
    const started = Date.now();
    let elapsed = 0;
    const now = vi
      .spyOn(Date, 'now')
      .mockImplementation(() => started + elapsed);
    try {
      const { peer, connector } = fixture({
        answer: (call) => {
          elapsed = 30_000;
          return answeredByPath({
            '/srv/a': page([passage('a.go', 1, 1)]),
            '/srv/b': page([passage('b.go', 1, 1)]),
          })(call);
        },
      });
      const result = await run(context(connector), {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
      });
      expect(result).toMatchObject({ status: 'success', complete: false });
      expect(warningsOf(result)).toEqual([{ kind: 'deadline', count: 1 }]);
      expect(locatorsOf(result)).toEqual(['machine://devl/srv/a/a.go:1-1']);
      const session = await peer.session(0);
      expect(session.calls).toHaveLength(1);
    } finally {
      now.mockRestore();
    }
  });

  it('keeps every passage of a file the page already holds', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([passage('a.go', 1, 1), passage('a.go', 3, 3)]),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      limit: 1,
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(result).toMatchObject({ status: 'success', complete: true });
    expect(locatorsOf(result)).toEqual([
      'machine://devl/srv/app/a.go:1-1',
      'machine://devl/srv/app/a.go:3-3',
    ]);
  });

  it('drops a passage of a second file once the file bound is full', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([passage('a.go', 1, 1), passage('b.go', 1, 1)]),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      limit: 1,
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(result).toMatchObject({ status: 'success', complete: false });
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/a.go:1-1']);
  });

  it('keeps a passage whose whole result fits the page and drops one that overflows it', async () => {
    // The page's own lines take the fixed reserve and the cursor that names
    // the passage takes its continuation line, so the largest passage that
    // fits beside them leaves exactly what is left of 15,000.
    const room =
      15_000 -
      pageFixedReserve() -
      DEADLINE_UNITS -
      grepContinuationUnits({ scopeIndex: 0, rel: 'a.go', startLine: 1 });
    const filled = fixture({
      answers: {
        'fs.grep': {
          value: page([
            {
              ...passage('a.go', 1, 1),
              content: contentOfUnits(locatorAt('a.go', 1, 1), room),
            },
          ]),
        },
      },
    });
    const kept = await run(context(filled.connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(kept).toMatchObject({ status: 'success', complete: true });
    expect(locatorsOf(kept)).toEqual(['machine://devl/srv/app/a.go:1-1']);
    expect(measureGrepRendering(kept)).toBeLessThanOrEqual(15_000);

    const over = fixture({
      answers: {
        'fs.grep': {
          value: page([
            {
              ...passage('a.go', 1, 1),
              content: contentOfUnits(locatorAt('a.go', 1, 1), room + 1),
            },
          ]),
        },
      },
    });
    const dropped = await run(context(over.connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(dropped).toMatchObject({ status: 'success', complete: false });
    expect(locatorsOf(dropped)).toEqual([]);
  });

  it('counts a following passage against the units already in the page', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([
            {
              ...passage('a.go', 1, 1),
              content: contentOfUnits(locatorAt('a.go', 1, 1), 1000),
            },
            {
              ...passage('a.go', 3, 3),
              content: contentOfUnits(locatorAt('a.go', 3, 3), 13_998),
            },
          ]),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(result).toMatchObject({ status: 'success', complete: false });
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/a.go:1-1']);
  });

  it('measures a following passage against the passage it follows', async () => {
    // The second passage fits only as a continuation of the first. Measured
    // alone it would carry its own `## <file>` line, and that extra line would
    // push the page over the bound.
    const first = passage('a.go', 1, 1);
    const firstWidth = measureGrepRendering({
      results: [
        {
          locator: locatorAt('a.go', 1, 1),
          content: '1: needle',
          matches: [1],
        },
      ],
      complete: true,
    });
    const continuation = grepContinuationUnits({
      scopeIndex: 0,
      rel: 'a.go',
      startLine: 3,
      capped: false,
    });
    const second = {
      ...passage('a.go', 3, 3, []),
      content: 'a'.repeat(
        15_000 -
          pageFixedReserve() -
          DEADLINE_UNITS -
          continuation -
          firstWidth -
          2,
      ),
    };
    const { connector } = fixture({
      answers: { 'fs.grep': { value: page([first, second]) } },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(result).toMatchObject({ status: 'success', complete: true });
    expect(locatorsOf(result)).toEqual([
      'machine://devl/srv/app/a.go:1-1',
      'machine://devl/srv/app/a.go:3-3',
    ]);
  });

  it('adds a passage to the units the page already holds', async () => {
    // The first two passages leave exactly enough for the third; a running
    // total that forgets them (or doubles one of them) drops it.
    const first = { ...passage('a.go', 1, 1, []), content: 'a'.repeat(5) };
    const second = { ...passage('a.go', 3, 3, []), content: 'b'.repeat(5) };
    const pairWidth = measureGrepRendering({
      results: [
        {
          locator: locatorAt('a.go', 1, 1),
          content: 'a'.repeat(5),
          matches: [],
        },
        {
          locator: locatorAt('a.go', 3, 3),
          content: 'b'.repeat(5),
          matches: [],
        },
      ],
      complete: true,
    });
    const continuation = grepContinuationUnits({
      scopeIndex: 0,
      rel: 'a.go',
      startLine: 5,
      capped: false,
    });
    const third = {
      ...passage('a.go', 5, 5, []),
      content: 'c'.repeat(
        15_000 -
          pageFixedReserve() -
          DEADLINE_UNITS -
          continuation -
          pairWidth -
          2,
      ),
    };
    const { connector } = fixture({
      answers: { 'fs.grep': { value: page([first, second, third]) } },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(result).toMatchObject({ status: 'success', complete: true });
    expect(locatorsOf(result)).toEqual([
      'machine://devl/srv/app/a.go:1-1',
      'machine://devl/srv/app/a.go:3-3',
      'machine://devl/srv/app/a.go:5-5',
    ]);
  });

  it('reserves the continuation line of a cut passage end line', async () => {
    // A cut passage names the line it stopped at, so its continuation cursor is
    // wider than a plain passage cursor. One unit past the bound that the wider
    // cursor leaves must drop the passage.
    const continuation = grepContinuationUnits({
      scopeIndex: 0,
      rel: 'a.go',
      startLine: 10,
      endLine: 40,
      capped: false,
    });
    const bare = measureGrepRendering({
      results: [
        {
          locator: locatorAt('a.go', 10, 40),
          content: '',
          matches: [],
          cut: true,
        },
      ],
      complete: true,
    });
    const cut = {
      ...passage('a.go', 10, 40, []),
      content: 'a'.repeat(
        15_000 - pageFixedReserve() - DEADLINE_UNITS - continuation - bare,
      ),
      cut: true as const,
    };
    const { connector } = fixture({
      answers: { 'fs.grep': { value: page([cut]) } },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(result).toMatchObject({ status: 'success', complete: false });
    expect(locatorsOf(result)).toEqual([]);
  });
});

describe('Machine resume', () => {
  it('resumes only the scope the cursor names', async () => {
    const scopes = ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'];
    const { peer, connector } = fixture({
      answer: answeredByPath({
        '/srv/a': page([passage('a.go', 1, 1)]),
        '/srv/b': page([passage('b.go', 1, 1)]),
      }),
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes,
      cursor: encodeGrepCursor({
        scopeIndex: 0,
        rel: 'a.go',
        startLine: 1,
        inputHash: hashOfScopes(scopes, ['devl', 'devl']),
      }),
    });
    expect(locatorsOf(result)).toEqual([
      'machine://devl/srv/a/a.go:1-1',
      'machine://devl/srv/b/b.go:1-1',
    ]);
    const session = await peer.session(0);
    expect(session.calls).toHaveLength(2);
    expect(session.calls[0].params).toHaveProperty('cursor');
    expect(session.calls[1].params).not.toHaveProperty('cursor');
  });

  it('carries a capped cursor to the daemon so it skips the file', async () => {
    const scope = 'machine://devl/srv/app/**';
    const { peer, connector } = fixture({
      answers: { 'fs.grep': { value: page([passage('b.go', 1, 1)]) } },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: [scope],
      cursor: encodeGrepCursor({
        scopeIndex: 0,
        rel: 'a.go',
        startLine: 20,
        truncated: true,
        inputHash: hashOfScopes([scope], ['devl']),
      }),
    });
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/b.go:1-1']);
    const session = await peer.session(0);
    expect(session.calls[0].params).toMatchObject({
      cursor: encodeGrepCursor({
        scopeIndex: 0,
        rel: 'a.go',
        startLine: 20,
        truncated: true,
        inputHash: fsGrepCursorKey({
          path: '/srv/app',
          globSuffix: '**',
          patterns: ['needle'],
          literal: false,
          ignoreCase: false,
        }),
      }),
    });
  });

  it('never asks a Machine scope the cursor already passed', async () => {
    const scopes = ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'];
    const { peer, connector } = fixture({
      answer: answeredByPath({
        '/srv/a': page([passage('a.go', 1, 1)]),
        '/srv/b': page([passage('b.go', 1, 1)]),
      }),
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes,
      cursor: encodeGrepCursor({
        scopeIndex: 1,
        rel: 'b.go',
        startLine: 1,
        inputHash: hashOfScopes(scopes, ['devl', 'devl']),
      }),
    });
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/b/b.go:1-1']);
    const session = await peer.session(0);
    expect(session.calls).toHaveLength(1);
    expect(session.calls[0].params).toMatchObject({ path: '/srv/b' });
  });

  it('marks the cursor capped from the passage the daemon capped', async () => {
    const pageOf = (cappedLast: boolean): ReadonlyArray<FsGrepPassage> =>
      Array.from({ length: 20 }, (_, index) => ({
        ...passage('a.go', index * 2 + 1, index * 2 + 1),
        truncated: true,
        ...(cappedLast && index === 19 && { capped: true as const }),
      }));
    // A page that happens to hold twenty passages caps nothing by itself: only
    // the file's own twentieth passage is marked, so a page that starts
    // mid-file still carries the flag the daemon set.
    const unmarked = fixture({
      answers: {
        'fs.grep': {
          value: page(pageOf(false), { complete: false, cursor: 'daemon' }),
        },
      },
    });
    const uncapped = await run(context(unmarked.connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(cursorPayloadOf(uncapped)).not.toHaveProperty('truncated');
    expect(cursorPayloadOf(uncapped)).not.toHaveProperty('endLine');

    const marked = fixture({
      answers: {
        'fs.grep': {
          value: page(pageOf(true), { complete: false, cursor: 'daemon' }),
        },
      },
    });
    const capped = await run(context(marked.connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(cursorPayloadOf(capped)).toMatchObject({ truncated: true });
  });

  it('names the last emitted line of a cut passage in the cursor', async () => {
    const scope = 'machine://devl/srv/app/**';
    const { peer, connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([{ ...passage('a.go', 10, 40), cut: true }], {
            complete: false,
            cursor: 'daemon',
          }),
        },
      },
    });
    const first = await run(context(connector), {
      patterns: ['needle'],
      scopes: [scope],
    });
    expect(cursorPayloadOf(first)).toMatchObject({
      startLine: 10,
      endLine: 40,
    });
    const cursor = success(first)['cursor'];
    if (!isString(cursor)) throw new Error('the page carries a cursor');
    // The next call asks the daemon to continue that passage, not skip it.
    await run(context(connector), {
      patterns: ['needle'],
      scopes: [scope],
      cursor,
    });
    const session = await peer.session(0);
    const searches = session.calls.filter((call) => call.method === 'fs.grep');
    expect(searches[1]?.params).toMatchObject({
      cursor: encodeGrepCursor({
        scopeIndex: 0,
        rel: 'a.go',
        startLine: 10,
        endLine: 40,
        inputHash: fsGrepCursorKey({
          path: '/srv/app',
          globSuffix: '**',
          patterns: ['needle'],
          literal: false,
          ignoreCase: false,
        }),
      }),
    });
  });

  it('forwards the cut flag of a passage the daemon cut', async () => {
    const cutFixture = fixture({
      answers: {
        'fs.grep': {
          value: page([{ ...passage('a.go', 10, 40), cut: true }]),
        },
      },
    });
    const cut = await run(context(cutFixture.connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(passagesOf(cut)[0]).toMatchObject({ cut: true });
    expect(renderGrepText(success(cut))).toContain(
      '[passage cut at the result bound; continue with the cursor]',
    );

    const plainFixture = fixture({
      answers: { 'fs.grep': { value: page([passage('a.go', 1, 1)]) } },
    });
    const plain = await run(context(plainFixture.connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(passagesOf(plain)[0]).not.toHaveProperty('cut');
  });

  it('resumes a Machine scope after the entry a position cursor names', async () => {
    const scope = 'machine://devl/srv/app/**';
    const { peer, connector } = fixture({
      answers: { 'fs.grep': { value: page([passage('b.go', 1, 1)]) } },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: [scope],
      cursor: encodeGrepCursor({
        kind: 'position',
        scopeIndex: 0,
        rel: 'a.go',
        inputHash: hashOfScopes([scope], ['devl']),
      }),
    });
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/b.go:1-1']);
    const session = await peer.session(0);
    expect(session.calls[0].params).toMatchObject({
      cursor: encodeGrepCursor({
        kind: 'position',
        scopeIndex: 0,
        rel: 'a.go',
        inputHash: fsGrepCursorKey({
          path: '/srv/app',
          globSuffix: '**',
          patterns: ['needle'],
          literal: false,
          ignoreCase: false,
        }),
      }),
    });
  });
});

describe('scope segments', () => {
  it('takes a Machine scope ordinal from the shared counter', async () => {
    await withNoteSpace(async (resolver) => {
      const scopes = [`kb://${SPACE_ID}`, 'machine://devl/srv/app/**'];
      const { peer, connector } = fixture({
        answers: { 'fs.grep': { value: page([passage('a.go', 1, 1)]) } },
      });
      const result = await run(
        context(connector, { knowledgeResolver: resolver }),
        {
          patterns: ['needle'],
          scopes,
          // The Space expansion holds ordinal 0, so the Machine scope is 1.
          cursor: encodeGrepCursor({
            scopeIndex: 1,
            rel: 'a.go',
            startLine: 1,
            inputHash: hashOfScopes(scopes, [SPACE_ID, 'devl']),
          }),
        },
      );
      expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/a.go:1-1']);
      const session = await peer.session(0);
      expect(session.calls[0]?.params).toMatchObject({
        cursor: encodeGrepCursor({
          scopeIndex: 0,
          rel: 'a.go',
          startLine: 1,
          inputHash: fsGrepCursorKey({
            path: '/srv/app',
            globSuffix: '**',
            patterns: ['needle'],
            literal: false,
            ignoreCase: false,
          }),
        }),
      });
    });
  });

  it('searches a local scope before the Machine scope it precedes', async () => {
    await withNoteSpace(async (resolver) => {
      const { peer, connector } = fixture({
        answers: { 'fs.grep': { value: page([passage('a.go', 1, 1)]) } },
      });
      const result = await run(
        context(connector, { knowledgeResolver: resolver }),
        {
          patterns: ['needle'],
          scopes: [`kb://${SPACE_ID}`, 'machine://devl/srv/app/**'],
        },
      );
      expect(locatorsOf(result)).toEqual([
        `kb://${SPACE_ID}/a.md:1-1`,
        'machine://devl/srv/app/a.go:1-1',
      ]);
      const session = await peer.session(0);
      expect(session.calls).toHaveLength(1);
    });
  });

  it('searches a Machine scope before the local scope it precedes', async () => {
    await withNoteSpace(async (resolver) => {
      const { connector } = fixture({
        answers: { 'fs.grep': { value: page([passage('a.go', 1, 1)]) } },
      });
      const result = await run(
        context(connector, { knowledgeResolver: resolver }),
        {
          patterns: ['needle'],
          scopes: ['machine://devl/srv/app/**', `kb://${SPACE_ID}`],
        },
      );
      expect(locatorsOf(result)).toEqual([
        'machine://devl/srv/app/a.go:1-1',
        `kb://${SPACE_ID}/a.md:1-1`,
      ]);
    });
  });
});

describe('grep deadline', () => {
  /** The walk deadline and the daemon's share of it, from one frozen call. */
  async function requestDeadlineMs(
    overrides: Partial<ToolContext>,
  ): Promise<{ walkMs: number; daemonMs: number }> {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { peer, connector } = fixture({
        answers: { 'fs.grep': { value: page([]) } },
      });
      await run(context(connector, overrides), {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/app/**'],
      });
      const session = await peer.session(0);
      const call = session.calls.find((entry) => entry.method === 'fs.grep');
      const params = call?.params;
      if (!isSerializableRecord(params))
        throw new Error('the request carries params');
      const envelope = params['envelope'];
      if (!isSerializableRecord(envelope))
        throw new Error('the request carries an envelope');
      const walkMs = envelope['budgetMs'];
      const daemonMs = boundsOf(params)['deadlineMs'];
      if (!isNumber(walkMs) || !isNumber(daemonMs))
        throw new Error('the request carries both deadlines');
      return { walkMs, daemonMs };
    } finally {
      vi.useRealTimers();
    }
  }

  it('leaves a margin under the default timeout', async () => {
    expect(await requestDeadlineMs({ timeoutMs: undefined })).toEqual({
      walkMs: 108_000,
      daemonMs: 97_200,
    });
  });

  it('keeps a partial page at the deadline with its cursor', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(0);
      let searches = 0;
      const { peer, connector } = fixture({
        answer: (call) => {
          if (call.method !== 'fs.grep') return undefined;
          searches += 1;
          // The first scope's answer spends the rest of the walk.
          vi.setSystemTime(109_000);
          return { value: page([passage('a.go', 1, 1)]) };
        },
      });
      const result = await run(
        context(connector, { timeoutMs: undefined, callTimeoutSeconds: 120 }),
        {
          patterns: ['needle'],
          scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
        },
      );
      expect(locatorsOf(result)).toEqual(['machine://devl/srv/a/a.go:1-1']);
      expect(success(result).complete).toBe(false);
      expect(success(result).warnings).toEqual([
        { kind: 'deadline', count: 1 },
      ]);
      expect(cursorPointOf(result)).toBeDefined();
      expect(measureGrepRendering(result)).toBeLessThanOrEqual(15_000);
      // The stopped call asks the second scope for nothing.
      expect(
        (await peer.session(0)).calls.filter(
          (call) => call.method === 'fs.grep',
        ),
      ).toHaveLength(1);
      expect(searches).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives a longer walk under a longer configured timeout', async () => {
    expect(
      await requestDeadlineMs({
        timeoutMs: undefined,
        callTimeoutSeconds: 300,
      }),
    ).toEqual({ walkMs: 270_000, daemonMs: 243_000 });
  });

  it('keeps half of a short timeout for the walk', async () => {
    expect(
      await requestDeadlineMs({ timeoutMs: undefined, callTimeoutSeconds: 6 }),
    ).toEqual({ walkMs: 3000, daemonMs: 2700 });
  });

  it('uses the configured timeout when the context carries none', async () => {
    expect(
      await requestDeadlineMs({
        timeoutMs: undefined,
        callTimeoutSeconds: 60,
      }),
    ).toEqual({ walkMs: 54_000, daemonMs: 48_600 });
describe('Machine excluded-directory report', () => {
  it('spells a daemon exclusion as a Machine scope', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([], {
            ignored: { paths: ['node_modules'], atLeast: false },
          }),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app'],
    });
    expect(ignoredOf(result)).toEqual({
      count: 1,
      locators: ['machine://devl/srv/app/node_modules'],
      atLeast: false,
    });
  });

  it('spells a bracketed Machine directory as a scope', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([], {
            ignored: { paths: ['app/[id]/node_modules'], atLeast: false },
          }),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app'],
    });
    expect(ignoredOf(result)?.locators).toEqual([
      'machine://devl/srv/app/app/%5Bid%5D/node_modules',
    ]);
  });

  it('keeps a literal percent spelled once in a Machine locator', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([], {
            ignored: { paths: ['100%41/node_modules'], atLeast: false },
          }),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app'],
    });
    expect(ignoredOf(result)?.locators).toEqual([
      'machine://devl/srv/app/100%2541/node_modules',
    ]);
  });

  it('hides a directory a reject names with a final separator', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([], {
            ignored: { paths: ['secrets'], atLeast: false },
          }),
        },
      },
    });
    const result = await run(
      context(connector, {
        permissionPolicy: compileToolPermissionMap(
          readingRejects('machine://devl/srv/app/secrets/'),
          'test',
        ),
      }),
      { patterns: ['needle'], scopes: ['machine://devl/srv/app'] },
    );
    expect(ignoredOf(result)).toBeUndefined();
  });

  it('names every directory in bypass mode', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([], {
            ignored: { paths: ['node_modules'], atLeast: false },
          }),
        },
      },
    });
    const result = await run(
      context(connector, {
        permissionMode: 'bypass',
        permissionPolicy: compileToolPermissionMap(
          readingRejects('/srv/app/node_modules'),
          'test',
        ),
      }),
      { patterns: ['needle'], scopes: ['machine://devl/srv/app'] },
    );
    expect(ignoredOf(result)?.locators).toEqual([
      'machine://devl/srv/app/node_modules',
    ]);
  });

  it('keeps an exclusion before the page cut and drops those after it', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([passage('a.go', 1, 1), passage('z.go', 1, 1)], {
            ignored: { paths: ['0', 'm'], atLeast: false },
          }),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
      limit: 1,
    });
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/a.go:1-1']);
    expect(ignoredOf(result)).toEqual({
      count: 1,
      locators: ['machine://devl/srv/app/0'],
      atLeast: false,
    });
  });

  it('reports an exclusion after the page cut on the next call only', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([passage('a.go', 1, 1), passage('z.go', 1, 1)], {
            ignored: { paths: ['m'], atLeast: false },
          }),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
      limit: 1,
    });
    expect(ignoredOf(result)).toBeUndefined();
  });

  it('carries the daemon lower bound', async () => {
    const paths = Array.from(
      { length: 1000 },
      (_, index) => `d${String(index).padStart(4, '0')}`,
    );
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([], { ignored: { paths, atLeast: true } }),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app'],
    });
    expect(ignoredOf(result)).toMatchObject({ count: 1000, atLeast: true });
  });

  it('caps the merged list again after a daemon that reports more', async () => {
    const paths = Array.from(
      { length: 1001 },
      (_, index) => `d${String(index).padStart(4, '0')}`,
    );
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([], { ignored: { paths, atLeast: false } }),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app'],
    });
    expect(ignoredOf(result)).toMatchObject({ count: 1000, atLeast: true });
  });
});

describe('daemon page stop conditions', () => {
  /** One page whose only passage the read group refuses, plus a cursor. */
  function refusedPage(consumed: {
    readonly files: number;
    readonly entries: number;
    readonly bytes: number;
  }): FsGrepSuccess {
    return page([passage('hidden.go', 1, 1)], {
      complete: false,
      cursor: 'daemon-next',
      consumed,
    });
  }

  function fsGrepCalls(session: {
    readonly calls: ReadonlyArray<{ readonly method: string }>;
  }): number {
    return session.calls.filter((call) => call.method === 'fs.grep').length;
  }

  const REJECTED = {
    permissionPolicy: compileToolPermissionMap(
      readingRejects('machine://devl/srv/app/hidden.go'),
      'test',
    ),
  };

  it('stops asking once the file bound is spent', async () => {
    const policy = {
      maxFilesExamined: 1,
      maxEntriesListed: null,
      maxBytesRead: null,
      maxFileBytes: null,
    };
    const { peer, connector } = fixture({
      answers: {
        'fs.grep': { value: refusedPage({ files: 1, entries: 1, bytes: 10 }) },
      },
    });
    const result = await run(
      context(connector, { ...REJECTED, grepBounds: policy }),
      { patterns: ['needle'], scopes: ['machine://devl/srv/app/**'] },
    );
    expect(result).toMatchObject({ status: 'success', complete: false });
    expect(fsGrepCalls(await peer.session(0))).toBe(1);
  });

  it('stops asking once the entry bound is spent', async () => {
    const policy = {
      maxFilesExamined: null,
      maxEntriesListed: 1,
      maxBytesRead: null,
      maxFileBytes: null,
    };
    const { peer, connector } = fixture({
      answers: {
        'fs.grep': { value: refusedPage({ files: 1, entries: 1, bytes: 10 }) },
      },
    });
    await run(context(connector, { ...REJECTED, grepBounds: policy }), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(fsGrepCalls(await peer.session(0))).toBe(1);
  });

  it('stops asking once the byte bound is spent', async () => {
    const policy = {
      maxFilesExamined: null,
      maxEntriesListed: null,
      maxBytesRead: 1,
      maxFileBytes: null,
    };
    const { peer, connector } = fixture({
      answers: {
        'fs.grep': { value: refusedPage({ files: 1, entries: 1, bytes: 10 }) },
      },
    });
    await run(context(connector, { ...REJECTED, grepBounds: policy }), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(fsGrepCalls(await peer.session(0))).toBe(1);
  });

  it('asks no page when the deadline instant arrives between pages', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(0);
      const { peer, connector } = fixture({
        answer: (call) => {
          if (call.method !== 'fs.grep') return undefined;
          // The page lands exactly on the 30-second walk deadline.
          vi.setSystemTime(30_000);
          return { value: refusedPage({ files: 1, entries: 1, bytes: 10 }) };
        },
      });
      await run(context(connector, REJECTED), {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/app/**'],
      });
      expect(fsGrepCalls(await peer.session(0))).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives a later scope a cursor when a spent bound skips it', async () => {
    // The first scope consumes the whole file bound with nothing to show: the
    // second scope is never asked, and the stop still resumes at its start.
    const { peer, connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([], { consumed: { files: 1, entries: 1, bytes: 10 } }),
        },
      },
    });
    const result = await run(
      context(connector, {
        grepBounds: {
          maxFilesExamined: 1,
          maxEntriesListed: null,
          maxBytesRead: null,
          maxFileBytes: null,
        },
      }),
      {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
      },
    );
    expect(locatorsOf(result)).toEqual([]);
    expect(success(result).complete).toBe(false);
    // The skipped scope names the bound that stopped the call.
    expect(success(result).warnings).toEqual([
      { kind: 'file_bound', count: 1 },
    ]);
    expect(cursorPayloadOf(result)).toMatchObject({
      kind: 'position',
      scopeIndex: 1,
      rel: '',
    });
    expect(fsGrepCalls(await peer.session(0))).toBe(1);
  });

  it('names a spent entry or byte bound when a later scope is skipped', async () => {
    const cases = [
      {
        policy: {
          maxFilesExamined: null,
          maxEntriesListed: 1,
          maxBytesRead: null,
          maxFileBytes: null,
        },
        warning: 'entry_bound',
      },
      {
        policy: {
          maxFilesExamined: null,
          maxEntriesListed: null,
          maxBytesRead: 1,
          maxFileBytes: null,
        },
        warning: 'byte_bound',
      },
      // A directory lists entries before it reaches a candidate, so the entry
      // bound is the one that would trip first.
      {
        policy: {
          maxFilesExamined: 1,
          maxEntriesListed: 1,
          maxBytesRead: null,
          maxFileBytes: null,
        },
        warning: 'entry_bound',
      },
    ] as const;
    for (const { policy, warning } of cases) {
      const { connector } = fixture({
        answers: {
          'fs.grep': {
            value: page([], { consumed: { files: 1, entries: 1, bytes: 10 } }),
          },
        },
      });
      const result = await run(context(connector, { grepBounds: policy }), {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
      });
      expect(success(result).complete).toBe(false);
      expect(success(result).warnings).toEqual([{ kind: warning, count: 1 }]);
    }
  });

  it('searches a direct-file scope when only the entry bound is spent', async () => {
    let searches = 0;
    const { peer, connector } = fixture({
      answer: (call) => {
        if (call.method === 'fs.stat')
          return { value: { kind: 'file', isLink: false } };
        if (call.method !== 'fs.grep') return undefined;
        searches += 1;
        return {
          value:
            searches === 1
              ? page([], { consumed: { files: 0, entries: 1, bytes: 0 } })
              : page([passage('', 1, 1)], {
                  consumed: { files: 1, entries: 0, bytes: 7 },
                }),
        };
      },
    });
    const result = await run(
      context(connector, {
        grepBounds: {
          maxFilesExamined: null,
          maxEntriesListed: 1,
          maxBytesRead: null,
          maxFileBytes: null,
        },
      }),
      {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/app.go'],
      },
    );
    // The file counts no entry, so the spent entry bound must not drop it.
    expect(searches).toBe(2);
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/b/app.go:1-1']);
    expect(success(result).complete).toBe(true);
    expect(success(result).warnings).toEqual([]);
    expect(fsGrepCalls(await peer.session(0))).toBe(2);
  });

  it('names the file bound for a skipped direct-file scope', async () => {
    let searches = 0;
    const { connector } = fixture({
      answer: (call) => {
        if (call.method === 'fs.stat')
          return { value: { kind: 'file', isLink: false } };
        if (call.method !== 'fs.grep') return undefined;
        searches += 1;
        return {
          value: page([], { consumed: { files: 1, entries: 1, bytes: 10 } }),
        };
      },
    });
    const result = await run(
      context(connector, {
        grepBounds: {
          maxFilesExamined: 1,
          maxEntriesListed: 1,
          maxBytesRead: null,
          maxFileBytes: null,
        },
      }),
      {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/app.go'],
      },
    );
    expect(searches).toBe(1);
    expect(success(result).complete).toBe(false);
    // A direct-file walk lists no entry, so its file bound trips first even
    // though the entry bound is spent too.
    expect(success(result).warnings).toEqual([
      { kind: 'file_bound', count: 1 },
    ]);
    expect(cursorPayloadOf(result)).toMatchObject({
      kind: 'position',
      scopeIndex: 1,
      rel: '',
    });
  });

  it('keeps a warning-only segment that exactly fills the page', async () => {
    const rel = 'a.go';
    const locator = 'machine://devl/srv/a/a.go:1-1';
    // The page's own lines once the warning merges: the base reserve plus the
    // warnings line that already carries the hub's deadline count, so the sum
    // lands exactly on the bound.
    const mergedLine = grepWarningsUnits(
      new Map([
        ['binary', 1],
        ['deadline', 1],
      ]),
    );
    const room =
      15_000 -
      pageFixedReserve() -
      mergedLine -
      grepContinuationUnits({ scopeIndex: 0, rel, startLine: 1 }) -
      grepPassageUnits(undefined, { locator, content: '1: ', matches: [1] });
    const filled = {
      ...passage(rel, 1, 1),
      content: `1: ${'x'.repeat(room)}`,
      matches: [1],
    };
    let searches = 0;
    const { connector } = fixture({
      answer: (call) => {
        if (call.method !== 'fs.grep') return undefined;
        searches += 1;
        return {
          value:
            searches === 1
              ? page([filled])
              : page([], {
                  warnings: [{ kind: 'binary', count: 1 }],
                  consumed: { files: 1, entries: 1, bytes: 10 },
                }),
        };
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
    });
    // The merged line takes the page exactly to its bound, so the counts stay.
    expect(locatorsOf(result)).toEqual([locator]);
    expect(success(result).warnings).toEqual([{ kind: 'binary', count: 1 }]);
    expect(success(result).complete).toBe(true);
    expect(measureGrepRendering(result)).toBeLessThanOrEqual(15_000);
  });

  it('refuses a passage the warnings line leaves no room for', async () => {
    const rel = 'a.go';
    const locator = 'machine://devl/srv/a/a.go:1-1';
    const warnings = [{ kind: 'binary' as const, count: 5 }];
    const warningUnits = grepWarningsUnits(new Map([['binary', 5]]));
    // The largest passage the page holds and then one warning line's worth
    // more: only an admission that forgot to keep the warnings line back
    // could take it.
    const room =
      15_000 -
      pageFixedReserve() -
      DEADLINE_UNITS -
      warningUnits -
      grepContinuationUnits({ scopeIndex: 0, rel, startLine: 1 }) -
      grepPassageUnits(undefined, { locator, content: '1: ', matches: [1] }) +
      warningUnits;
    const filled = {
      ...passage(rel, 1, 1),
      content: `1: ${'x'.repeat(room)}`,
      matches: [1],
    };
    const { connector } = fixture({
      answers: { 'fs.grep': { value: page([filled], { warnings }) } },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/a/**'],
    });
    expect(locatorsOf(result)).toEqual([]);
    expect(success(result).complete).toBe(false);
  });
});
