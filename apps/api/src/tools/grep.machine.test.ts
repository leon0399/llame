import { drizzle } from 'drizzle-orm/postgres-js';

import {
  fsGrepCursorKey,
  PATH_NOT_REGISTERED_MESSAGE,
  type FsGrepBudget,
  type FsGrepPassage,
  type FsGrepSuccess,
} from '@workspace/machine-protocol';
import { encodeGrepCursor, hashGrepInputs } from '@workspace/native-file-tools';
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';
import { describe, expect, it } from 'vitest';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { MachineConnector } from '../machines/machine-connector.service';
import { type MachineStatusView } from '../machines/machines-status';
import {
  createProtocolPeer,
  type ProtocolPeerOptions,
} from '../testing/machine-protocol-peer';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { grepInputSchema, nativeGrepTool } from './grep';
import { projectGrepScope } from './grep-admission';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { type ToolPermissionMap } from './permissions/types';
import { type ToolContext, type ToolResult } from './types';
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

/** The passage an opaque grep cursor names, which a test may read. */
function cursorPointOf(result: ToolResult) {
  const cursor = success(result)['cursor'];
  if (!isString(cursor)) throw new Error('the page carries a cursor');
  // SAFETY: JSON.parse returns any; asserting unknown forces the check below.
  const payload = JSON.parse(
    Buffer.from(cursor, 'base64url').toString('utf8'),
  ) as unknown;
  if (!isRecord(payload)) throw new Error('the cursor is an object');
  const { rel, startLine } = payload;
  if (!isString(rel) || !isNumber(startLine))
    throw new Error('the cursor names a passage');
  return { rel, startLine };
}

/** The hash `grep.ts` binds this call's cursor to. */
function inputHashOf(scope: string): string {
  return hashGrepInputs({
    patterns: ['needle'],
    literal: false,
    ignoreCase: false,
    projectedScopes: [projectGrepScope(scope, undefined).prefix],
    resolvedRoots: ['devl'],
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
      inputHash: inputHashOf(scope),
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
