import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';

import {
  fsGrepCursorKey,
  isSerializableRecord,
  PATH_NOT_REGISTERED_MESSAGE,
  type SerializableRecord,
  type FsGrepBudget,
  type FsGrepPassage,
  type FsGrepSuccess,
  type JsonValue,
} from '@workspace/machine-protocol';
import {
  encodeGrepCursor,
  hashGrepInputs,
  measureNativeModelOutput,
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
  type PeerCall,
  type ProtocolPeerOptions,
} from '../testing/machine-protocol-peer';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { grepInputSchema, nativeGrepTool } from './grep';
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

const BUDGET: FsGrepBudget = {
  files: 5000,
  entries: 20_000,
  bytes: 32 * 1024 * 1024,
  deadlineMs: 30_000,
  limit: 20,
  pageUnits: 15_000,
};

type Fixture = {
  readonly connector: MachineConnector;
  readonly peer: ReturnType<typeof createProtocolPeer>;
};

function fixture(options: ProtocolPeerOptions = {}): Fixture {
  const peer = createProtocolPeer(options);
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
    permissionPolicy: compileTestPermissionPolicy(['grep']),
    tenantDb: {
      runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    },
    machines: connector,
    machineStatus: { list: () => Promise.resolve(STATUS) },
    machineAttemptKey: 'attempt-1',
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
      budget: {
        files: BUDGET.files,
        entries: BUDGET.entries,
        bytes: BUDGET.bytes,
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

  it('carries the remaining budget to a second Machine scope', async () => {
    const { peer, connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([], {
            consumed: { files: 1, entries: 1, bytes: 30 * 1024 * 1024 },
          }),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
    });
    expect(result.status).toBe('success');
    const session = await peer.session(0);
    expect(session.calls).toHaveLength(2);
    expect(session.calls[1].params).toMatchObject({
      path: '/srv/b',
      budget: { bytes: 2 * 1024 * 1024, files: 4999, entries: 19_999 },
    });
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

/** The budget one request carried, as the peer received it. */
function budgetOf(params: JsonValue | undefined): SerializableRecord {
  if (!isSerializableRecord(params))
    throw new Error('the request carries params');
  const budget = params['budget'];
  if (!isSerializableRecord(budget))
    throw new Error('the request carries a budget');
  return budget;
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

/** Content whose rendered passage serializes to exactly `units` code units. */
function contentOfUnits(
  locator: string,
  units: number,
  matches: ReadonlyArray<number> = [1],
): string {
  const empty = measureNativeModelOutput({ locator, content: '', matches }) - 2;
  return 'a'.repeat(units - empty);
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
    expect(session.calls[0].params).toMatchObject({
      literal: true,
      ignoreCase: true,
      envelope: { budgetMs: 30_000 },
    });
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
    // Both passages with the separator between them, less the page's own
    // brackets: the two serializations are exactly what the page holds.
    const rendered =
      measureNativeModelOutput({
        locator: 'machine://devl/srv/a/a.go:1-1',
        content: '1: needle',
        matches: [1],
      }) +
      measureNativeModelOutput({
        locator: 'machine://devl/srv/a/a.go:3-3',
        content: '3: needle',
        matches: [3],
      });
    expect(session.calls[1].params).toMatchObject({
      path: '/srv/b',
      budget: {
        files: 4999,
        entries: 19_998,
        bytes: 32 * 1024 * 1024 - 100,
        limit: 19,
        pageUnits: 15_000 - rendered,
      },
    });
    const budget = budgetOf(session.calls[1].params);
    expect(budget['deadlineMs']).toBeGreaterThan(0);
    expect(budget['deadlineMs']).toBeLessThanOrEqual(30_000);
  });

  it('reserves the brackets of a page that holds one passage', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.grep': { value: page([passage('a.go', 1, 1)]) } },
    });
    await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
    });
    const session = await peer.session(0);
    const rendered = measureNativeModelOutput({
      locator: 'machine://devl/srv/a/a.go:1-1',
      content: '1: needle',
      matches: [1],
    });
    expect(budgetOf(session.calls[1].params)).toMatchObject({
      pageUnits: 15_000 - rendered - 1,
    });
  });

  it('hands a following scope the page brackets when it kept nothing', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.grep': { value: page([]) } },
    });
    await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
    });
    const session = await peer.session(0);
    expect(budgetOf(session.calls[1].params)).toMatchObject({
      pageUnits: 14_998,
      limit: 20,
    });
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

  it('keeps a passage that fills the page exactly and drops one unit more', async () => {
    const filled = fixture({
      answers: {
        'fs.grep': {
          value: page([
            {
              ...passage('a.go', 1, 1),
              content: contentOfUnits(locatorAt('a.go', 1, 1), 14_998),
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

    const over = fixture({
      answers: {
        'fs.grep': {
          value: page([
            {
              ...passage('a.go', 1, 1),
              content: contentOfUnits(locatorAt('a.go', 1, 1), 14_999),
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

  it('marks a cursor capped at the last passage of a truncated file', async () => {
    const truncatedPages: ReadonlyArray<FsGrepPassage> = Array.from(
      { length: 20 },
      (_, index) => ({
        ...passage('a.go', index * 2 + 1, index * 2 + 1),
        truncated: true,
      }),
    );
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page(truncatedPages, { complete: false, cursor: 'daemon' }),
        },
      },
    });
    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(cursorPayloadOf(result)).toMatchObject({ truncated: true });

    const plain = fixture({
      answers: {
        'fs.grep': {
          value: page(
            [
              {
                ...passage('a.go', 1, 1),
                truncated: true,
              },
            ],
            { complete: false, cursor: 'daemon' },
          ),
        },
      },
    });
    const first = await run(context(plain.connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(cursorPayloadOf(first)).not.toHaveProperty('truncated');

    const exhausted = fixture({
      answers: {
        'fs.grep': {
          value: page(
            Array.from({ length: 20 }, (_, index) =>
              passage('a.go', index * 2 + 1, index * 2 + 1),
            ),
            { complete: false, cursor: 'daemon' },
          ),
        },
      },
    });
    const twentieth = await run(context(exhausted.connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });
    expect(cursorPayloadOf(twentieth)).not.toHaveProperty('truncated');
  });
});

describe('scope segments', () => {
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
