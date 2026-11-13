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
  grepIgnoredUnits,
  spellGrepMachineScopeLocator,
  type GrepBudget,
} from '@workspace/native-file-tools';
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';
import { describe, expect, it, vi } from 'vitest';

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
import { renderToolResultText } from './model-text';
import { createGrepReadAdmission } from './grep-admission';
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
  const db: Db = drizzle.mock();

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
    configuredCredentials: overrides.configuredCredentials ?? [],
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

  it('never reports a passage the read group refuses', async () => {
    let searches = 0;

    const { connector } = fixture({
      answer: (call) => {
        if (call.method !== 'fs.grep') return undefined;
        searches += 1;

        return {
          value:
            searches === 1
              ? page([passage('a.go', 1, 1), passage('b.go', 4, 4)], {
                  complete: false,
                  cursor: 'daemon-cursor',
                })
              : page([]),
        };
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
    expect(result).not.toHaveProperty('cursor');
    expect(JSON.stringify(result)).not.toContain('b.go');
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
        progressed: false,
        admission: createGrepReadAdmission(contextOf),
        keepPassages: () => true,
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
      progressed: false,
      admission: createGrepReadAdmission(contextOf),
      keepPassages: () => true,
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
    expect(result).not.toHaveProperty('cursor');
  });

  it('names an unfinished single-file scope', async () => {
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
            cursor: 'daemon-next',
          }),
        },
      },
    });

    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: [scope],
    });

    expect(success(result)).toMatchObject({
      complete: false,
      unfinishedFile: 'machine://devl/var/log/huge.log',
    });
    expect(result).not.toHaveProperty('cursor');
    // A single-file walk ignores a cursor, so its stop ends the scope: no
    // second search is asked for it.
    const session = await peer.session(0);
    expect(session.calls.map((call) => call.method)).toEqual([
      'fs.stat',
      'fs.grep',
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
  it('marks no artifact for a cut passage the walk never continued', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([{ ...passage('a.go', 1, 2), cut: true }], {
            complete: false,
            warnings: [{ kind: 'deadline', count: 1 }],
          }),
        },
      },
    });

    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv'],
    });

    // No artifact stores the rest of the passage, so the marker would lie; the
    // stop is reported by `complete` and its warning instead.
    const text = renderToolResultText('grep', result);
    expect(text).not.toContain('[passage cut; the artifact holds the rest]');
    expect(text).toContain('[warnings: 1 deadline]');
    expect(success(result)).not.toHaveProperty('artifact');
    expect(success(result).complete).toBe(false);
  });

  it('stops the walked Machine scope at the artifact bound', async () => {
    const { peer, connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([passage('a.go', 1, 1), passage('b.go', 2, 2)]),
        },
      },
    });

    const result = await run(context(connector, { artifactMaxBytes: 40 }), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv'],
    });

    const session = await peer.session(0);
    // The first passage fills the bound, so the walk asks for no next page.
    expect(
      session.calls.filter((call) => call.method === 'fs.grep'),
    ).toHaveLength(1);
    expect(warningsOf(result)).toEqual([{ kind: 'artifact_bound', count: 1 }]);
    expect(success(result).complete).toBe(false);
  });

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
    // The internal page shape is the daemon's own, so the page a following
    // scope gets differs only by the operator bounds the first one spent.
    expect(session.calls[1].params).toMatchObject({
      path: '/srv/b',
      bounds: {
        files: 4999,
        entries: 19_998,
        bytes: 32 * 1024 * 1024 - 100,
        limit: 20,
        pageUnits: 15_000 - pageFixedReserve(),
      },
    });
    const bounds = boundsOf(session.calls[1].params);
    expect(bounds['deadlineMs']).toBeGreaterThan(0);
    expect(bounds['deadlineMs']).toBeLessThanOrEqual(30_000);
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

    // The refused page never ends the walk: the call asks for the next daemon
    // page, under what the first one left.
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

  it('stops at the file bound a page of refused passages reached', async () => {
    const scope = 'machine://devl/srv/app/**';

    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([passage('hidden.go', 1, 1)], {
            complete: false,
            cursor: 'daemon-next',
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
    // The file budget is spent, so the call stops and names that bound, and
    // the refused file is named nowhere: the walk never reports a passage a
    // `read` cannot reach.
    expect(success(result).warnings).toEqual([
      { kind: 'file_bound', count: 1 },
    ]);
    expect(result).not.toHaveProperty('cursor');
    expect(JSON.stringify(result)).not.toContain('hidden.go');
  });

  it('stops after a scope whose walk is incomplete', async () => {
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
    expect(result).not.toHaveProperty('cursor');
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/a/a.go:1-1']);
    const session = await peer.session(0);
    expect(session.calls).toHaveLength(1);
  });

  it('ends the walk when the call deadline expires and says why', async () => {
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

  it('pins the rendered ignored line width', () => {
    const rendered =
      '[ignored 1 directory: machine://devl/srv/app/m; a scope that names one searches it]';

    expect(
      grepIgnoredUnits(
        {
          count: 1,
          locators: ['machine://devl/srv/app/m'],
          atLeast: false,
        },
        spellGrepMachineScopeLocator,
      ),
    ).toBe(rendered.length + 1);
  });
});

describe('Machine pages within one call', () => {
  /** The page key the daemon binds a request for one glob scope to. */
  function daemonKey(globSuffix: string | undefined): string {
    return fsGrepCursorKey({
      path: '/srv/app',
      globSuffix,
      patterns: ['needle'],
      literal: false,
      ignoreCase: false,
    });
  }

  it('asks the next page after one that kept a passage', async () => {
    let searches = 0;

    const { peer, connector } = fixture({
      answer: (call) => {
        if (call.method !== 'fs.grep') return undefined;
        searches += 1;

        return {
          value:
            searches === 1
              ? page([passage('a.go', 1, 1)], {
                  complete: false,
                  cursor: 'daemon-next',
                  consumed: { files: 1, entries: 1, bytes: 10 },
                })
              : page([passage('b.go', 1, 1)]),
        };
      },
    });

    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });

    // A page that kept a passage does not end the walk: the next daemon page
    // is asked inside the same call.
    expect(locatorsOf(result)).toEqual([
      'machine://devl/srv/app/a.go:1-1',
      'machine://devl/srv/app/b.go:1-1',
    ]);
    expect(success(result).complete).toBe(true);

    const asked = (await peer.session(0)).calls.filter(
      (call) => call.method === 'fs.grep',
    );

    expect(asked).toHaveLength(2);
    expect(asked[1]?.params).toMatchObject({ cursor: 'daemon-next' });
  });

  it('joins a passage a daemon page cut and its continuation', async () => {
    let searches = 0;

    const { connector } = fixture({
      answer: (call) => {
        if (call.method !== 'fs.grep') return undefined;
        searches += 1;

        return {
          value:
            searches === 1
              ? page([{ ...passage('a.go', 10, 40), cut: true }], {
                  complete: false,
                  cursor: 'daemon-next',
                  consumed: { files: 0, entries: 1, bytes: 10 },
                })
              : page([passage('a.go', 41, 50)]),
        };
      },
    });

    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });

    // The page bound is internal, so the model reads one whole passage.
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/a.go:10-50']);
    expect(passagesOf(result)[0]).not.toHaveProperty('cut');
    expect(success(result).complete).toBe(true);
  });

  it('skips the file a daemon page stopped inside and asks after it', async () => {
    const scope = 'machine://devl/srv/app/**';

    const stoppedAt = encodeGrepCursor({
      kind: 'position',
      scopeIndex: 0,
      rel: 'a.go',
      inputHash: daemonKey('**'),
    });

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
                  unfinished: 'a.go',
                  cursor: stoppedAt,
                  warnings: [{ kind: 'deadline', count: 1 }],
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

    // The walk continues past the file the daemon could not finish, and the
    // result still says that file was left behind.
    expect(locatorsOf(result)).toEqual(['machine://devl/srv/app/b.go:1-1']);
    expect(success(result)).toMatchObject({
      complete: false,
      unfinishedFile: 'machine://devl/srv/app/a.go',
    });

    const asked = (await peer.session(0)).calls.filter(
      (call) => call.method === 'fs.grep',
    );

    expect(asked).toHaveLength(2);
    // The next response is asked after the daemon position of the first, so
    // the skipped file is never opened twice in the call.
    expect(asked[1]?.params).toMatchObject({ cursor: stoppedAt });
    // The stop came before the call progressed, so the next request says so
    // and the daemon names the file its own stop hides.
    expect(boundsOf(asked[1]?.params)['progressed']).toBe(false);
  });

  it('ends the scope at a second skipped file and keeps the first', async () => {
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
                  unfinished: 'a.go',
                  cursor: encodeGrepCursor({
                    kind: 'position',
                    scopeIndex: 0,
                    rel: 'a.go',
                    inputHash: daemonKey('**'),
                  }),
                  consumed: { files: 1, entries: 1, bytes: 10 },
                })
              : searches === 2
                ? page([], {
                    complete: false,
                    unfinished: 'b.go',
                    cursor: encodeGrepCursor({
                      kind: 'position',
                      scopeIndex: 0,
                      rel: 'b.go',
                      inputHash: daemonKey('**'),
                    }),
                    consumed: { files: 1, entries: 1, bytes: 10 },
                  })
                : page([passage('c.go', 1, 1)]),
        };
      },
    });

    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: [scope],
    });

    // The first file the call could not finish is the one it names, and the
    // walk ends there: the next call opens the second file with a full budget
    // instead of walking on with the first one lost.
    expect(success(result)).toMatchObject({
      complete: false,
      unfinishedFile: 'machine://devl/srv/app/a.go',
    });
    expect(locatorsOf(result)).toEqual([]);
    expect(result).not.toHaveProperty('cursor');

    const asked = (await peer.session(0)).calls.filter(
      (call) => call.method === 'fs.grep',
    );

    expect(asked).toHaveLength(2);
  });

  it('resumes after a skipped file when a later page kept nothing', async () => {
    const scope = 'machine://devl/srv/app/**';

    const stoppedAt = encodeGrepCursor({
      kind: 'position',
      scopeIndex: 0,
      rel: 'a.go',
      inputHash: daemonKey('**'),
    });

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
                  unfinished: 'a.go',
                  cursor: stoppedAt,
                  consumed: { files: 1, entries: 1, bytes: 10 },
                })
              : page([]),
        };
      },
    });

    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: [scope],
    });

    // The scope then ended with nothing kept, so the call resumes after the
    // file it skipped, not at the scope's start.
    expect(success(result)).toMatchObject({
      complete: false,
      unfinishedFile: 'machine://devl/srv/app/a.go',
    });
    expect(locatorsOf(result)).toEqual([]);
    expect(result).not.toHaveProperty('cursor');

    const asked = (await peer.session(0)).calls.filter(
      (call) => call.method === 'fs.grep',
    );

    expect(asked).toHaveLength(2);
  });

  it('names the bound a page spent at its own page end', async () => {
    // The daemon fills its page with the last files the file bound leaves and
    // ends before it reports the stop, so the hub names the bound itself.
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page(
            Array.from({ length: 20 }, (_, index) =>
              passage(`f${String(index)}.go`, 1, 1),
            ),
            {
              complete: false,
              cursor: 'daemon-next',
              consumed: { files: 20, entries: 20, bytes: 200 },
            },
          ),
        },
      },
    });

    const result = await run(
      context(connector, {
        grepBounds: {
          maxFilesExamined: 20,
          maxEntriesListed: null,
          maxBytesRead: null,
          maxFileBytes: null,
        },
      }),
      { patterns: ['needle'], scopes: ['machine://devl/srv/app/**'] },
    );

    expect(warningsOf(result)).toEqual([{ kind: 'file_bound', count: 1 }]);
    expect(success(result).complete).toBe(false);
  });

  it('drops the daemon page deadline when the walk completed', async () => {
    let searches = 0;

    const { connector } = fixture({
      answer: (call) => {
        if (call.method !== 'fs.grep') return undefined;
        searches += 1;

        return {
          value:
            searches === 1
              ? page([passage('a.go', 1, 1)], {
                  complete: false,
                  cursor: 'daemon-next',
                  consumed: { files: 1, entries: 1, bytes: 10 },
                  warnings: [{ kind: 'deadline', count: 1 }],
                })
              : page([passage('b.go', 1, 1)]),
        };
      },
    });

    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });

    // One response's time budget did not stop the walk.
    expect(success(result).complete).toBe(true);
    expect(warningsOf(result)).toEqual([]);
    expect(locatorsOf(result)).toHaveLength(2);
  });

  it('reports the daemon deadline once on a stopped walk', async () => {
    let searches = 0;

    const { connector } = fixture({
      answer: (call) => {
        if (call.method !== 'fs.grep') return undefined;
        searches += 1;

        return {
          value:
            searches === 1
              ? page([passage('a.go', 1, 1)], {
                  complete: false,
                  cursor: 'daemon-next',
                  consumed: { files: 1, entries: 1, bytes: 10 },
                  warnings: [{ kind: 'deadline', count: 1 }],
                })
              : page([], {
                  complete: false,
                  warnings: [{ kind: 'deadline', count: 1 }],
                }),
        };
      },
    });

    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });

    expect(success(result).complete).toBe(false);
    expect(warningsOf(result)).toEqual([{ kind: 'deadline', count: 1 }]);
  });

  it('asks no page after a complete one, even with a cursor', async () => {
    let searches = 0;

    const { peer, connector } = fixture({
      answer: (call) => {
        if (call.method !== 'fs.grep') return undefined;
        searches += 1;

        return {
          value: page([passage('a.go', 1, 1)], { cursor: 'daemon-stale' }),
        };
      },
    });

    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });

    expect(success(result).complete).toBe(true);

    const asked = (await peer.session(0)).calls.filter(
      (call) => call.method === 'fs.grep',
    );

    expect(asked).toHaveLength(1);
    expect(searches).toBe(1);
  });

  it('keeps the bound a page already named', async () => {
    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([passage('a.go', 1, 1)], {
            complete: false,
            cursor: 'daemon-next',
            consumed: { files: 5000, entries: 1, bytes: 10 },
            warnings: [{ kind: 'deadline', count: 1 }],
          }),
        },
      },
    });

    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });

    // The page named its own stop; a spent file budget must not be added.
    expect(warningsOf(result)).toEqual([{ kind: 'deadline', count: 1 }]);
    expect(success(result).complete).toBe(false);
  });

  it('names the deadline when the call time ran out between pages', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });

    try {
      vi.setSystemTime(0);

      const { connector } = fixture({
        answer: (call) => {
          if (call.method !== 'fs.grep') return undefined;
          // The page spends the whole 3-second walk of a 6-second call.
          vi.setSystemTime(3000);

          return {
            value: page([passage('a.go', 1, 1)], {
              complete: false,
              cursor: 'daemon-next',
              consumed: { files: 1, entries: 1, bytes: 10 },
            }),
          };
        },
      });

      const result = await run(context(connector, { timeoutMs: 6000 }), {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/app/**'],
      });

      expect(warningsOf(result)).toEqual([{ kind: 'deadline', count: 1 }]);
      expect(success(result).complete).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts a directory a second daemon page repeated once', async () => {
    let searches = 0;

    const { connector } = fixture({
      answer: (call) => {
        if (call.method !== 'fs.grep') return undefined;
        searches += 1;

        return {
          value:
            searches === 1
              ? page([], {
                  complete: false,
                  cursor: 'daemon-next',
                  consumed: { files: 1, entries: 1, bytes: 10 },
                  ignored: { paths: ['node_modules'], atLeast: false },
                })
              : page([passage('a.ts', 1, 1)], {
                  ignored: {
                    paths: ['node_modules', 'dist'],
                    atLeast: false,
                  },
                }),
        };
      },
    });

    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/app/**'],
    });

    // The page asked again after a position below the excluded directory
    // lists it again; the call names each directory once.
    expect(ignoredOf(result)).toEqual({
      count: 2,
      locators: [
        'machine://devl/srv/app/node_modules',
        'machine://devl/srv/app/dist',
      ],
      atLeast: false,
    });
  });

  it('carries what one Machine scope left to the next scope', async () => {
    let searches = 0;

    const { peer, connector } = fixture({
      answer: (call) => {
        if (call.method !== 'fs.grep') return undefined;
        searches += 1;

        if (searches === 1)
          return {
            value: page([], {
              complete: false,
              cursor: 'daemon-next',
              consumed: { files: 1, entries: 1, bytes: 40 },
            }),
          };

        if (searches === 2)
          return {
            value: page([], {
              complete: false,
              cursor: 'daemon-third',
              consumed: { files: 0, entries: 0, bytes: 30 },
            }),
          };

        return { value: page([]) };
      },
    });

    await run(
      context(connector, {
        grepBounds: {
          maxFilesExamined: null,
          maxEntriesListed: null,
          maxBytesRead: 100,
          maxFileBytes: null,
        },
      }),
      {
        patterns: ['needle'],
        scopes: ['machine://devl/srv/a/**', 'machine://devl/srv/b/**'],
      },
    );

    const asked = (await peer.session(0)).calls.filter(
      (call) => call.method === 'fs.grep',
    );

    // Two pages of the first scope spend 40 and 30 bytes, so the second scope
    // is asked for what is left of the call's byte bound.
    expect(asked.map((call) => boundsOf(call.params)['bytes'])).toEqual([
      100, 60, 30, 30,
    ]);
    expect(asked[3]?.params).toMatchObject({ path: '/srv/b' });
  });
});

describe('scope segments', () => {
  it('takes a Machine scope ordinal after a bare Knowledge scope', async () => {
    await withNoteSpace(async (resolver) => {
      const scopes = [`kb://${SPACE_ID}`, 'machine://devl/srv/app/**'];

      const { connector } = fixture({
        answers: { 'fs.grep': { value: page([passage('a.go', 1, 1)]) } },
      });

      const result = await run(
        context(connector, { knowledgeResolver: resolver }),
        { patterns: ['needle'], scopes },
      );

      // The Space expansion holds ordinal 0 and the Machine scope ordinal 1,
      // so the Space's passage comes first.
      expect(locatorsOf(result)).toEqual([
        `kb://${SPACE_ID}/a.md:1-1`,
        'machine://devl/srv/app/a.go:1-1',
      ]);
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

  it('keeps a partial result at the deadline', async () => {
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
      expect(result).not.toHaveProperty('cursor');
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
  });
});

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

  it('counts recorded directories before the read filter', async () => {
    const paths = Array.from(
      { length: 1000 },
      (_, index) => `d${String(index).padStart(4, '0')}`,
    );

    const { connector } = fixture({
      answers: {
        'fs.grep': {
          value: page([], {
            ignored: { paths: [...paths, 'keep'], atLeast: false },
          }),
        },
      },
    });

    const result = await run(
      context(connector, {
        permissionPolicy: compileToolPermissionMap(
          {
            grep: { allow: true },
            read: {
              allow: true,
              reject: [{ field: 'path', regex: '/d\\d{4}$' }],
            },
          },
          'test',
        ),
      }),
      { patterns: ['needle'], scopes: ['machine://devl/srv/app'] },
    );

    expect(ignoredOf(result)).toBeUndefined();
  });

  it('caps two Machine scopes together', async () => {
    const paths = (prefix: string) =>
      Array.from(
        { length: 600 },
        (_, index) => `${prefix}${String(index).padStart(4, '0')}`,
      );

    const { connector } = fixture({
      answer: answeredByPath({
        '/srv/a': page([], {
          ignored: { paths: paths('a'), atLeast: false },
        }),
        '/srv/b': page([], {
          ignored: { paths: paths('b'), atLeast: false },
        }),
      }),
    });

    const result = await run(context(connector), {
      patterns: ['needle'],
      scopes: ['machine://devl/srv/a', 'machine://devl/srv/b'],
    });

    expect(ignoredOf(result)).toMatchObject({
      count: 1000,
      atLeast: true,
    });
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

  it('names a spent file bound when a later scope is skipped', async () => {
    // The first scope consumes the whole file bound with nothing to show: the
    // second scope is never asked, and the stop still names the bound.
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
    expect(result).not.toHaveProperty('cursor');
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
    expect(result).not.toHaveProperty('cursor');
  });
});
