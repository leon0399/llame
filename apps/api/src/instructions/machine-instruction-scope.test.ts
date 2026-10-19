/**
 * The Machine instruction world: the registered-root scope one Machine target
 * resolves in, and the instructions producer's Machine groups, which are its
 * only caller. Both live here because they share one in-memory Machine, and the
 * tests then exercise the production path end to end: `roots.list` decides the
 * containing root, `fs.stat`/`fs.list` answer as untrusted JSON, and every
 * candidate is labelled by its canonical Machine locator.
 *
 * The Machine is a real `MachineConnector` with its answer surface replaced, so
 * the probe under test is the production one and no SSH process is ever
 * started; the page reader is the Run's own seam, faked over the same bodies.
 */

import {
  FS_LIST_METHOD,
  FS_STAT_METHOD,
  MachineProtocolError,
  ROOTS_LIST_METHOD,
  type JsonValue,
  type MachineMethod,
  type MachineMethodParams,
} from '@workspace/machine-protocol';
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';

import type { AuthoredContextItemPart } from '../chats/context-item';
import {
  instructionsSeenPaths,
  isInstructionsPayload,
} from '../chats/instructions-item';
import {
  MachineConnector,
  MachineUnavailableError,
} from '../machines/machine-connector.service';
import { parseMachineLocator } from '../machines/machine-locator';
import type { MachineRequestOptions } from '../machines/machine-session';
import { machineEnvelope } from '../runs/machine-attempt';
import type { InRunToolCall } from '../runs/in-run-context-items';
import { type InstructionScope, type ReadPage } from './instruction-files';
import {
  createInstructionsProducer,
  machineTarget,
} from './instructions-producer';
import {
  createMachineInstructionProbe,
  type MachineInstructionProbe,
} from './machine-instruction-scope';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const MACHINE = 'devl';
/** The one directory `devl` registers in most of these tests. */
const ROOT = '/home/me/shop';

const MACHINES = {
  ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
  hosts: { [MACHINE]: { destination: 'box' } },
};

/** Everything one test declares about the Machine it talks to. */
type MachineTree = {
  /** The roots this Machine registers, in its own order. */
  readonly roots?: ReadonlyArray<string>;
  /** The files it holds, by absolute Machine path, with their bodies. */
  readonly files?: Readonly<Record<string, string | undefined>>;
  /** Directories it holds that declare no file of their own. */
  readonly directories?: ReadonlyArray<string>;
  /** The canonical path `fs.stat` reports for one path, as a link's target. */
  readonly realPaths?: Readonly<Record<string, string | undefined>>;
  /** Paths it holds that are neither files nor directories. */
  readonly others?: ReadonlyArray<string>;
  /** Paths whose every operation it refuses as outside its roots. */
  readonly refused?: ReadonlyArray<string>;
  /** Whether it answers at all during this attempt (the reachability verdict). */
  readonly answers?: boolean;
  /** Whether every request fails, as a session lost after the verdict does. */
  readonly failsRequests?: boolean;
  /** A `fs.stat` answer the protocol does not promise. */
  readonly rawStat?: JsonValue;
  /** A `roots.list` answer the protocol does not promise. */
  readonly rawRoots?: JsonValue;
};

/** The durable identity and budget one request carried, as the hub built it. */
type RecordedEnvelope = {
  readonly runId?: string;
  readonly deliverySeq?: number;
  readonly budgetMs: number;
};

/** One request the hub sent this Machine, in arrival order. */
type RecordedRequest = {
  readonly name: string;
  readonly method: string;
  /** The absolute Machine path the request named, when it named one. */
  readonly path: string | undefined;
  readonly envelope: RecordedEnvelope | undefined;
  /** The call's own cancellation, as the caller passed it. */
  readonly signal: AbortSignal | undefined;
};

/** The absolute Machine path one request's params name, narrowed untrusted. */
function requestPath(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined;
  const path = params['path'];
  return isString(path) ? path : undefined;
}

/** The envelope one request's params carry, narrowed untrusted. */
function requestEnvelope(params: unknown): RecordedEnvelope | undefined {
  if (!isRecord(params)) return undefined;
  const envelope = params['envelope'];
  if (!isRecord(envelope)) return undefined;
  const budgetMs = envelope['budgetMs'];
  if (!isNumber(budgetMs)) return undefined;
  const runId = envelope['runId'];
  const deliverySeq = envelope['deliverySeq'];
  return {
    ...(isString(runId) && { runId }),
    ...(isNumber(deliverySeq) && { deliverySeq }),
    budgetMs,
  };
}

/**
 * A Machine without SSH: it answers `roots.list`, `fs.stat`, and `fs.list` from
 * the tree the test declares, records every request, and can fail the way an
 * unavailable or refusing Machine does.
 */
class MachinePeer extends MachineConnector {
  readonly recorded: Array<RecordedRequest> = [];
  /** The attempt key each reachability verdict was asked under, in order. */
  readonly attemptKeys: Array<string> = [];
  private readonly tree: MachineTree;

  constructor(tree: MachineTree = {}) {
    super({ machines: MACHINES, hubVersion: '9.9.9' });
    this.tree = tree;
  }

  override reachable(_name: string, attemptKey: string): Promise<boolean> {
    this.attemptKeys.push(attemptKey);
    return Promise.resolve(this.tree.answers ?? true);
  }

  override request<M extends MachineMethod>(
    name: string,
    method: M,
    params: MachineMethodParams[M],
    options: MachineRequestOptions = {},
  ): Promise<JsonValue> {
    const path = requestPath(params);
    const envelope = requestEnvelope(params);
    this.recorded.push({
      name,
      method,
      path,
      envelope,
      signal: options.signal,
    });
    return Promise.resolve(this.answer(name, method, path));
  }

  private answer(
    name: string,
    method: string,
    path: string | undefined,
  ): JsonValue {
    if (this.tree.failsRequests ?? false) {
      throw new MachineUnavailableError(
        name,
        'session_lost',
        true,
        'The Machine session was lost.',
      );
    }
    if (!(this.tree.answers ?? true)) {
      throw new MachineUnavailableError(
        name,
        'unreachable',
        false,
        'The Machine is unreachable.',
      );
    }
    if (path !== undefined && (this.tree.refused ?? []).includes(path)) {
      throw new MachineProtocolError(
        'path_not_registered',
        'The path is outside the Machine roots.',
      );
    }
    if (method === ROOTS_LIST_METHOD) {
      return this.tree.rawRoots ?? { roots: [...(this.tree.roots ?? [])] };
    }
    if (method === FS_STAT_METHOD) {
      return this.tree.rawStat ?? this.statOf(path);
    }
    if (method === FS_LIST_METHOD) {
      return path !== undefined && this.isDirectory(path)
        ? { entries: this.entriesOf(path), totalCount: 0, truncated: false }
        : { status: 'error', type: 'not_found', message: 'No such directory.' };
    }
    throw new Error(`The Machine has no method ${method}.`);
  }

  private statOf(path: string | undefined): JsonValue {
    if (path === undefined) return { kind: 'missing', isLink: false };
    const canonical = this.tree.realPaths?.[path] ?? path;
    const body = this.tree.files?.[path];
    if (body !== undefined) {
      return {
        kind: 'file',
        isLink: canonical !== path,
        size: Buffer.byteLength(body, 'utf8'),
        realPath: canonical,
      };
    }
    if (this.isDirectory(path)) {
      return {
        kind: 'directory',
        isLink: canonical !== path,
        realPath: canonical,
      };
    }
    if ((this.tree.others ?? []).includes(path)) {
      return { kind: 'other', isLink: false };
    }
    return { kind: 'missing', isLink: false };
  }

  private entriesOf(path: string): JsonValue {
    return this.children(path).map((name) => ({
      name,
      kind: this.kindOf(`${path === '/' ? '' : path}/${name}`),
    }));
  }

  private kindOf(path: string): string {
    const stat = this.statOf(path);
    return isRecord(stat) && isString(stat['kind']) ? stat['kind'] : 'other';
  }

  private isDirectory(path: string | undefined): boolean {
    if (path === undefined) return false;
    if ((this.tree.directories ?? []).includes(path)) return true;
    return this.children(path).length > 0;
  }

  private children(path: string): Array<string> {
    const prefix = path === '/' ? '/' : `${path}/`;
    const names = new Set<string>();
    for (const declared of [
      ...Object.keys(this.tree.files ?? {}),
      ...(this.tree.directories ?? []),
    ]) {
      if (!declared.startsWith(prefix) || declared === path) continue;
      names.add(declared.slice(prefix.length).split('/')[0]);
    }
    return [...names];
  }
}

/**
 * One Machine the hub loads instruction files from: the peer above, the real
 * probe over its answers, a page reader over the same bodies, and the two
 * records a test asserts on — every target the producer asked the probe about,
 * and every page it then read.
 */
function machineWorld(tree: MachineTree = {}) {
  const connector = new MachinePeer(tree);
  const probe = createMachineInstructionProbe({
    connector,
    envelope: machineEnvelope({ runId: RUN_ID, deliverySequence: 1 }),
  });
  const probed: Array<{ readonly name: string; readonly path: string }> = [];
  const reads: Array<string> = [];
  const readPage: ReadPage = (selectorPath) => {
    reads.push(selectorPath);
    const marker = selectorPath.lastIndexOf(':raw:');
    const parsed = parseMachineLocator(
      marker < 0 ? selectorPath : selectorPath.slice(0, marker),
    );
    const content =
      parsed.kind === 'path' ? tree.files?.[parsed.path] : undefined;
    return Promise.resolve(
      content === undefined
        ? { status: 'error', type: 'not_found', message: 'No such file.' }
        : { status: 'success', kind: 'file', content, truncated: false },
    );
  };
  const world = {
    connector,
    readPage,
    reads,
    /** The probe spy: what the producer asked about, in order. */
    probed,
    probe: (input: {
      readonly name: string;
      readonly path: string;
    }): Promise<InstructionScope | undefined> => {
      probed.push(input);
      return probe(input);
    },
  };
  return world;
}

/** The absolute Machine paths one Machine was asked about outside `root`. */
function outside(
  recorded: ReadonlyArray<RecordedRequest>,
  root: string,
): Array<string> {
  return recorded
    .flatMap((request) => (request.path === undefined ? [] : [request.path]))
    .filter((path) => path !== root && !path.startsWith(`${root}/`));
}

/** Every directory the hub asked one Machine to list. */
function listed(recorded: ReadonlyArray<RecordedRequest>): Array<string> {
  return recorded.flatMap((request) =>
    request.method === FS_LIST_METHOD && request.path !== undefined
      ? [request.path]
      : [],
  );
}

/** One native `read` of a Machine locator, as the executor would observe it. */
function machineCall(
  locator: string,
  toolName = 'read',
  workspaceRoot?: string,
): InRunToolCall {
  return { toolName, input: { path: locator }, workspaceRoot };
}

/** One attempt's producer plus the items it stages at each step. */
function attemptOf(
  input: {
    readonly machines?: {
      readonly readPage: ReadPage;
      readonly probe: MachineInstructionProbe;
    };
    /** `null` builds the attempt with no host page reader at all. */
    readonly hostReadPage?: ReadPage | null;
  } = {},
) {
  const staged: Array<AuthoredContextItemPart> = [];
  const hostReads: Array<string> = [];
  const hostReadPage =
    input.hostReadPage === null
      ? undefined
      : (input.hostReadPage ??
        ((selectorPath: string) => {
          hostReads.push(selectorPath);
          return Promise.resolve({
            status: 'error' as const,
            type: 'not_found' as const,
            message: 'No such file.',
          });
        }));
  const producer = createInstructionsProducer().beginAttempt({
    runId: RUN_ID,
    chatId: '22222222-2222-4222-8222-222222222222',
    userId: 'owner',
    admitsRead: () => true,
    ...(hostReadPage !== undefined && { readPage: hostReadPage }),
    ...(input.machines !== undefined && { machines: input.machines }),
  });
  return {
    producer,
    staged,
    hostReads,
    prepare: async () => {
      await producer.prepareStep({
        messages: [],
        stepNumber: 1,
        stage: (part) => {
          staged.push(part);
        },
      });
    },
  };
}

/** The selected locators an item discloses, in block order. */
function blockPaths(part: AuthoredContextItemPart): Array<string> {
  const payload = part.data.payload;
  if (!isInstructionsPayload(payload)) {
    throw new Error('the staged part is not an instructions payload');
  }
  return payload.files.map((file) => file.path);
}

/** The imported-by link of every loaded file, in block order. */
function importedBy(part: AuthoredContextItemPart): Array<string | undefined> {
  const payload = part.data.payload;
  if (!isInstructionsPayload(payload)) {
    throw new Error('the staged part is not an instructions payload');
  }
  return payload.files.map((file) => file.importedBy);
}

/** The canonical seen keys an item discloses. */
function seenKeys(part: AuthoredContextItemPart): Array<string> {
  return [...instructionsSeenPaths([part])];
}

/** The last item a step staged, failing loudly when the step staged none. */
function lastStaged(
  staged: ReadonlyArray<AuthoredContextItemPart>,
): AuthoredContextItemPart {
  const part = staged.at(-1);
  if (part === undefined) throw new Error('the step staged no item');
  return part;
}

/** The locator of one absolute Machine path. */
function locator(path: string, name = MACHINE): string {
  return `machine://${name}${path}`;
}

/** One Machine scope's own `readPage` for a target, over a declared tree. */
function scopeOf(tree: MachineTree, path: string, name = MACHINE) {
  const connector = new MachinePeer(tree);
  const probe = createMachineInstructionProbe({
    connector,
    envelope: machineEnvelope({ runId: RUN_ID, deliverySequence: 1 }),
  });
  return probe({ name, path }).then((scope) => ({ connector, scope }));
}

describe('Machine target projection', () => {
  it('names one Machine and the absolute path inside it', () => {
    // The scheme and the name are canonicalized, the selector is dropped, and
    // the decoded path is normalized before it is ever addressed.
    expect(
      machineTarget('MACHINE://DEVL/home/me/shop/src/app.ts:10-20'),
    ).toEqual({
      machine: { name: MACHINE },
      key: `${ROOT}/src/app.ts`,
    });
    expect(machineTarget(`${locator(ROOT)}/src/`)).toEqual({
      machine: { name: MACHINE },
      key: `${ROOT}/src`,
    });
    expect(machineTarget(`${locator(ROOT)}/src/../AGENTS.md`)).toEqual({
      machine: { name: MACHINE },
      key: `${ROOT}/AGENTS.md`,
    });
  });

  it('names nothing for a locator that addresses no path, or a host path', () => {
    for (const value of [
      'machine://',
      `machine://${MACHINE}`,
      'machine://Dev_L/x',
      `${ROOT}/AGENTS.md`,
      `kb://${MACHINE}/x.md`,
    ]) {
      expect(machineTarget(value)).toBeUndefined();
    }
  });
});

describe('Machine instruction scope', () => {
  const tree: MachineTree = {
    roots: [ROOT],
    files: {
      [`${ROOT}/AGENTS.md`]: 'shop rules\n',
      [`${ROOT}/src/app.ts`]: 'app\n',
    },
    directories: [`${ROOT}/src`],
  };

  it('addresses one target inside the registered root that contains it', async () => {
    const { connector, scope } = await scopeOf(tree, `${ROOT}/src/app.ts`);

    expect(scope?.root).toBe(ROOT);
    // Keys are absolute Machine paths, with the empty key the root itself, and
    // every label is the canonical locator of the path it names.
    expect(scope?.label('')).toBe(locator(ROOT));
    expect(scope?.label('src')).toBe(locator(`${ROOT}/src`));
    expect(scope?.label(`${ROOT}/src/app.ts`)).toBe(
      locator(`${ROOT}/src/app.ts`),
    );
    expect(scope?.label(`${ROOT}/src/`)).toBe(locator(`${ROOT}/src`));
    await expect(scope?.probe('src/app.ts')).resolves.toEqual({
      kind: 'file',
      size: 4,
      canonicalPath: locator(`${ROOT}/src/app.ts`),
    });
    await expect(scope?.probe('src')).resolves.toEqual({
      kind: 'directory',
      size: 0,
      canonicalPath: locator(`${ROOT}/src`),
    });
    await expect(scope?.probe('nope')).resolves.toEqual({ kind: 'missing' });
    await expect(scope?.list('')).resolves.toEqual(['AGENTS.md', 'src']);
    await expect(scope?.list('src')).resolves.toEqual(['app.ts']);

    // The roots were asked for once, and every path asked about is the root's
    // own or one of its children: an ancestor is never named at all.
    expect(connector.recorded[0]).toEqual({
      name: MACHINE,
      method: ROOTS_LIST_METHOD,
      path: undefined,
      envelope: machineEnvelope({ runId: RUN_ID, deliverySequence: 1 }),
    });
    expect(outside(connector.recorded, ROOT)).toEqual([]);
  });

  it('reports the path the Machine resolved as the file identity', async () => {
    const { scope } = await scopeOf(
      {
        roots: [ROOT],
        files: { [`${ROOT}/link.md`]: 'rules\n' },
        realPaths: { [`${ROOT}/link.md`]: `${ROOT}/real.md` },
      },
      `${ROOT}/link.md`,
    );

    await expect(scope?.probe('link.md')).resolves.toEqual({
      kind: 'file',
      size: 6,
      canonicalPath: locator(`${ROOT}/real.md`),
    });
  });

  it('starts at the longest registered root that contains the target', async () => {
    const nested = `${ROOT}/packages`;
    const { scope } = await scopeOf(
      {
        roots: [ROOT, nested],
        files: {
          [`${ROOT}/AGENTS.md`]: 'shop rules\n',
          [`${nested}/AGENTS.md`]: 'package rules\n',
          [`${nested}/ui/x.ts`]: 'ui\n',
        },
      },
      `${nested}/ui/x.ts`,
    );

    expect(scope?.root).toBe(nested);
    expect(scope?.label('')).toBe(locator(nested));
    expect(scope?.label(`${nested}/AGENTS.md`)).toBe(
      locator(`${nested}/AGENTS.md`),
    );
  });

  it('keeps the narrowest root whatever order the Machine lists them in', async () => {
    const nested = `${ROOT}/packages`;
    const { scope } = await scopeOf(
      {
        // The narrow root first: the broad one that follows contains the same
        // target and must not take the bound from it.
        roots: [nested, ROOT],
        files: { [`${nested}/AGENTS.md`]: 'package rules\n' },
      },
      `${nested}/AGENTS.md`,
    );

    expect(scope?.root).toBe(nested);
    expect(scope?.label('')).toBe(locator(nested));
  });

  it('answers no scope for a target no registered root contains', async () => {
    const above = await scopeOf(tree, '/home/me/AGENTS.md');
    const beside = await scopeOf(tree, `${ROOT}x/AGENTS.md`);

    expect(above.scope).toBeUndefined();
    expect(beside.scope).toBeUndefined();
    // A target outside every root is decided from `roots.list` alone: no
    // stat, no listing, and therefore nothing revealed about the Machine.
    for (const { connector } of [above, beside]) {
      expect(connector.recorded.map((request) => request.method)).toEqual([
        ROOTS_LIST_METHOD,
      ]);
    }
  });

  it('answers no scope for a target spelled relative to nothing', async () => {
    // Machine keys are absolute Machine paths, so a relative target names no
    // path at all — not even one the whole filesystem contains, and not one
    // that only looks absolute once a trailing separator is resolved.
    const bare = await scopeOf({ roots: ['/'] }, 'src/app.ts');
    const trailing = await scopeOf({ roots: ['/'] }, 'src/');

    expect(bare.scope).toBeUndefined();
    expect(trailing.scope).toBeUndefined();
    for (const { connector } of [bare, trailing]) {
      expect(connector.recorded.map((request) => request.method)).toEqual([
        ROOTS_LIST_METHOD,
      ]);
    }
  });

  it('ignores a registered root that is not an absolute path', async () => {
    const { scope, connector } = await scopeOf(
      { roots: ['relative/root'] },
      'relative/root/AGENTS.md',
    );

    // A registered root is a canonical realpath: a relative one names no
    // directory a chain may start at, however well it prefixes the target.
    expect(scope).toBeUndefined();
    expect(connector.recorded.map((request) => request.method)).toEqual([
      ROOTS_LIST_METHOD,
    ]);
  });

  it('keys the reachability verdict by the envelope it was built with', async () => {
    const unnamed = new MachinePeer({ roots: [ROOT] });
    await createMachineInstructionProbe({
      connector: unnamed,
      // An envelope that names no Run is keyed by the empty run id, never by a
      // placeholder: a holder of the verdict can rebuild the same key.
      envelope: machineEnvelope({ deliverySequence: 1 }),
    })({ name: MACHINE, path: `${ROOT}/AGENTS.md` });

    const named = new MachinePeer({ roots: [ROOT] });
    await createMachineInstructionProbe({
      connector: named,
      envelope: machineEnvelope({ runId: RUN_ID, deliverySequence: 3 }),
    })({ name: MACHINE, path: `${ROOT}/AGENTS.md` });

    expect(unnamed.attemptKeys).toEqual(['\u00001']);
    expect(named.attemptKeys).toEqual([`${RUN_ID}\u00003`]);
  });

  it('answers no scope for an unknown, an unreachable, or a non-answering Machine', async () => {
    const unknown = await scopeOf(tree, `${ROOT}/src/app.ts`, 'gpu');
    const unreachable = await scopeOf(
      { ...tree, answers: false },
      `${ROOT}/src/app.ts`,
    );

    expect(unknown.scope).toBeUndefined();
    // An unconfigured or unreachable Machine is refused before anything is
    // asked of it: the reachability verdict alone decides, so no request —
    // not even `roots.list` — ever leaves the hub.
    expect(unknown.connector.recorded).toEqual([]);
    expect(unreachable.scope).toBeUndefined();
    expect(unreachable.connector.recorded).toEqual([]);
  });

  it('treats a root registered with a trailing separator as the same bound', async () => {
    const { scope } = await scopeOf(
      { roots: [`${ROOT}/`], files: { [`${ROOT}/src/app.ts`]: 'app\n' } },
      `${ROOT}/src/app.ts`,
    );

    expect(scope?.root).toBe(ROOT);
    expect(scope?.label('')).toBe(locator(ROOT));
  });

  it('treats a root of the whole filesystem as containing every path', async () => {
    const { scope } = await scopeOf(
      { roots: ['/'], files: { '/etc/hosts': 'box\n' } },
      '/etc/hosts',
    );

    expect(scope?.root).toBe('/');
    expect(scope?.label('')).toBe(`machine://${MACHINE}/`);
    // A key relative to a root that ends in a separator joins it directly, so
    // the whole filesystem's own key space is the one the loader names.
    expect(scope?.label('etc/hosts')).toBe(`machine://${MACHINE}/etc/hosts`);
    await expect(scope?.probe('/etc/hosts')).resolves.toEqual({
      kind: 'file',
      size: 4,
      canonicalPath: `machine://${MACHINE}/etc/hosts`,
    });
  });

  it('loads nothing, and asks nothing twice, when the listing itself fails', async () => {
    const connector = new MachinePeer({ ...tree, failsRequests: true });
    const probe = createMachineInstructionProbe({
      connector,
      envelope: machineEnvelope({ runId: RUN_ID, deliverySequence: 1 }),
    });

    expect(
      await probe({ name: MACHINE, path: `${ROOT}/src/app.ts` }),
    ).toBeUndefined();
    expect(
      await probe({ name: MACHINE, path: `${ROOT}/AGENTS.md` }),
    ).toBeUndefined();
    // A session lost after the verdict is one failure for the attempt: the
    // second trigger does not wait out another one.
    expect(connector.recorded.map((request) => request.method)).toEqual([
      ROOTS_LIST_METHOD,
    ]);
  });

  it('keeps an answer it could not use, and asks that Machine once', async () => {
    const connector = new MachinePeer({ ...tree, rawRoots: { roots: 3 } });
    const probe = createMachineInstructionProbe({
      connector,
      envelope: machineEnvelope({ runId: RUN_ID, deliverySequence: 1 }),
    });

    expect(
      await probe({ name: MACHINE, path: `${ROOT}/src/app.ts` }),
    ).toBeUndefined();
    expect(
      await probe({ name: MACHINE, path: `${ROOT}/AGENTS.md` }),
    ).toBeUndefined();
    expect(connector.recorded.map((request) => request.method)).toEqual([
      ROOTS_LIST_METHOD,
    ]);
  });

  it('reads a missing, a non-regular, a refused, and an unspeakable entry as missing', async () => {
    const { scope } = await scopeOf(
      {
        roots: [ROOT],
        files: { [`${ROOT}/AGENTS.md`]: 'rules\n' },
        others: [`${ROOT}/device`],
        refused: [`${ROOT}/secret`],
        rawStat: { kind: 'nonsense', isLink: false },
      },
      `${ROOT}/src/app.ts`,
    );

    await expect(scope?.probe('device')).resolves.toEqual({ kind: 'missing' });
    // A Machine that refuses the path, and one that answers something other
    // than the protocol promises, are the same thing to a chain: nothing here.
    await expect(scope?.probe('secret')).resolves.toEqual({ kind: 'missing' });
    await expect(scope?.probe('anything')).resolves.toEqual({
      kind: 'missing',
    });
    await expect(scope?.list('secret')).resolves.toEqual([]);
    await expect(scope?.list('missing')).resolves.toEqual([]);
  });

  it('carries the envelope and budget the caller built into every request', async () => {
    const { connector, scope } = await scopeOf(tree, `${ROOT}/src/app.ts`);
    await scope?.probe('src');
    await scope?.list('src');

    expect(connector.recorded.map((request) => request.envelope)).toEqual([
      { runId: RUN_ID, deliverySeq: 1, budgetMs: 30_000 },
      { runId: RUN_ID, deliverySeq: 1, budgetMs: 30_000 },
      { runId: RUN_ID, deliverySeq: 1, budgetMs: 30_000 },
    ]);
  });

  it("carries the caller's own cancellation into every request it makes", async () => {
    const controller = new AbortController();
    const connector = new MachinePeer(tree);
    const probe = createMachineInstructionProbe({
      connector,
      envelope: machineEnvelope({ runId: RUN_ID, deliverySequence: 1 }),
      signal: controller.signal,
    });

    const scope = await probe({ name: MACHINE, path: `${ROOT}/src/app.ts` });
    await scope?.probe('src');
    await scope?.list('src');

    // The root list, the stat, and the listing are all one Run's work: every
    // one of them is cancellable by the signal the Run handed the probe.
    expect(connector.recorded.map((request) => request.signal)).toEqual([
      controller.signal,
      controller.signal,
      controller.signal,
    ]);

    const bare = await scopeOf(tree, `${ROOT}/src/app.ts`);
    await bare.scope?.probe('src');
    expect(bare.connector.recorded.map((request) => request.signal)).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('instructions producer Machine world', () => {
  it("loads the registered root's chain down to the touched directory", async () => {
    const world = machineWorld({
      roots: [ROOT],
      files: {
        [`${ROOT}/AGENTS.md`]: 'shop rules\n',
        [`${ROOT}/src/AGENTS.md`]: 'src rules\n',
        [`${ROOT}/src/app.ts`]: 'app\n',
        // Above the registered root: never read, and never even asked about.
        '/home/me/AGENTS.md': 'above the root\n',
      },
    });
    const { producer, staged, hostReads, prepare } = attemptOf({
      machines: world,
    });

    producer.observeToolCall?.(machineCall(locator(`${ROOT}/src/app.ts`)));
    await prepare();

    const part = lastStaged(staged);
    expect(blockPaths(part)).toEqual([
      locator(`${ROOT}/AGENTS.md`),
      locator(`${ROOT}/src/AGENTS.md`),
    ]);
    expect(world.reads).toEqual([
      `${locator(`${ROOT}/AGENTS.md`)}:raw:1-2000`,
      `${locator(`${ROOT}/src/AGENTS.md`)}:raw:1-2000`,
    ]);
    expect(seenKeys(part)).toEqual(blockPaths(part));
    // The root bounds the walk: nothing above it is probed, listed, or read,
    // and the host world contributes nothing at all.
    expect(world.probed).toEqual([
      { name: MACHINE, path: `${ROOT}/src/app.ts` },
    ]);
    expect(outside(world.connector.recorded, ROOT)).toEqual([]);
    expect(hostReads).toEqual([]);
  });

  it('walks the registered root itself when the trigger is the root', async () => {
    const world = machineWorld({
      roots: [ROOT],
      files: {
        [`${ROOT}/AGENTS.md`]: 'shop rules\n',
        // The registered root's own key must not be read a second time as a
        // path inside itself, which would reach this file.
        [`${ROOT}/home/me/shop/AGENTS.md`]: 'a root spelled twice\n',
      },
    });
    const { producer, staged, prepare } = attemptOf({ machines: world });

    producer.observeToolCall?.(machineCall(`${locator(ROOT)}/`));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([
      locator(`${ROOT}/AGENTS.md`),
    ]);
    expect(listed(world.connector.recorded)).toEqual([ROOT]);
    expect(outside(world.connector.recorded, ROOT)).toEqual([]);
  });

  it('walks each registered root from its own bound', async () => {
    const other = '/srv/app';
    const world = machineWorld({
      roots: [ROOT, other],
      files: {
        [`${ROOT}/AGENTS.md`]: 'shop rules\n',
        [`${other}/AGENTS.md`]: 'service rules\n',
        [`${other}/x.ts`]: 'x\n',
      },
    });
    const { producer, staged, prepare } = attemptOf({ machines: world });

    producer.observeToolCall?.(machineCall(locator(`${other}/x.ts`)));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([
      locator(`${other}/AGENTS.md`),
    ]);
    expect(world.probed).toEqual([{ name: MACHINE, path: `${other}/x.ts` }]);
  });

  it("groups one Machine's touches by the root each was resolved in", async () => {
    const other = '/srv/app';
    const world = machineWorld({
      roots: [ROOT, other],
      files: {
        [`${ROOT}/AGENTS.md`]: 'shop rules\n',
        [`${ROOT}/src/app.ts`]: 'app\n',
        [`${other}/AGENTS.md`]: 'service rules\n',
        [`${other}/x.ts`]: 'x\n',
      },
    });
    const { producer, staged, prepare } = attemptOf({ machines: world });

    producer.observeToolCall?.(machineCall(locator(`${ROOT}/src/app.ts`)));
    producer.observeToolCall?.(machineCall(locator(`${other}/x.ts`)));
    await prepare();

    // Two roots are two worlds: the build order of every directory each one
    // walks follows the root it was resolved in.
    expect(blockPaths(lastStaged(staged))).toEqual([
      locator(`${ROOT}/AGENTS.md`),
      locator(`${other}/AGENTS.md`),
    ]);
    expect(listed(world.connector.recorded)).toEqual([
      ROOT,
      `${ROOT}/src`,
      other,
    ]);
  });

  it('resolves two Machine touches in one step into one bundle', async () => {
    const world = machineWorld({
      roots: [ROOT],
      files: {
        [`${ROOT}/AGENTS.md`]: 'shop rules\n',
        [`${ROOT}/src/AGENTS.md`]: 'src rules\n',
        [`${ROOT}/test/AGENTS.md`]: 'test rules\n',
        [`${ROOT}/src/app.ts`]: 'app\n',
        [`${ROOT}/test/app.test.ts`]: 'test\n',
      },
    });
    const { producer, staged, prepare } = attemptOf({ machines: world });

    producer.observeToolCall?.(machineCall(locator(`${ROOT}/src/app.ts`)));
    producer.observeToolCall?.(
      machineCall(locator(`${ROOT}/test/app.test.ts`)),
    );
    await prepare();

    // One group per Machine root, one probe per touch, and the bundle in
    // directory order with the root walked once.
    expect(world.probed).toEqual([
      { name: MACHINE, path: `${ROOT}/src/app.ts` },
      { name: MACHINE, path: `${ROOT}/test/app.test.ts` },
    ]);
    expect(blockPaths(lastStaged(staged))).toEqual([
      locator(`${ROOT}/AGENTS.md`),
      locator(`${ROOT}/src/AGENTS.md`),
      locator(`${ROOT}/test/AGENTS.md`),
    ]);
    expect(listed(world.connector.recorded)).toEqual([
      ROOT,
      `${ROOT}/src`,
      `${ROOT}/test`,
    ]);
  });

  it('ignores a Machine trigger entirely without a Machine capability', async () => {
    const world = machineWorld({
      roots: [ROOT],
      files: { [`${ROOT}/AGENTS.md`]: 'shop rules\n' },
    });
    const without = attemptOf();

    without.producer.observeToolCall?.(machineCall(locator(`${ROOT}/x.ts`)));
    await without.prepare();

    // The trigger is dropped before any filesystem — the Machine's or this
    // worker's — is touched or probed.
    expect(without.staged).toEqual([]);
    expect(world.probed).toEqual([]);
    expect(world.reads).toEqual([]);

    const with_ = attemptOf({ machines: world });
    with_.producer.observeToolCall?.(machineCall(locator(`${ROOT}/x.ts`)));
    await with_.prepare();

    expect(blockPaths(lastStaged(with_.staged))).toEqual([
      locator(`${ROOT}/AGENTS.md`),
    ]);
  });

  it('loads nothing for a target no registered root contains', async () => {
    const world = machineWorld({
      roots: [ROOT],
      files: {
        [`${ROOT}/AGENTS.md`]: 'shop rules\n',
        '/etc/hostname': 'box\n',
      },
    });
    const { producer, staged, prepare } = attemptOf({ machines: world });

    producer.observeToolCall?.(machineCall(locator('/etc/hostname')));
    await prepare();

    expect(staged).toEqual([]);
    expect(world.probed).toEqual([{ name: MACHINE, path: '/etc/hostname' }]);
    expect(world.connector.recorded.map((r) => r.method)).toEqual([
      ROOTS_LIST_METHOD,
    ]);
  });

  it('keeps the candidate a Machine read disclosed, by locator', async () => {
    const world = machineWorld({
      roots: [ROOT],
      files: {
        [`${ROOT}/AGENTS.md`]: 'shop rules\n',
        [`${ROOT}/src/AGENTS.md`]: 'src rules\n',
        [`${ROOT}/src/app.ts`]: 'app\n',
      },
    });
    const { producer, staged, prepare } = attemptOf({ machines: world });

    producer.observeToolCall?.(machineCall(locator(`${ROOT}/src/AGENTS.md`)));
    await prepare();

    // The read named the file, so that file is not restaged as an instruction
    // file; the root's own chain still loads.
    const part = lastStaged(staged);
    expect(blockPaths(part)).toEqual([locator(`${ROOT}/AGENTS.md`)]);
    expect(seenKeys(part)).toEqual([locator(`${ROOT}/AGENTS.md`)]);
  });

  it('treats a Machine Workspace root as a Machine trigger on the turn', async () => {
    const world = machineWorld({
      roots: [ROOT],
      files: { [`${ROOT}/AGENTS.md`]: 'shop rules\n' },
    });
    const part = await createInstructionsProducer().prepareTurn?.({
      runId: RUN_ID,
      workspaceRoot: locator(ROOT),
      admitsRead: () => true,
      seenKeys: new Set(),
      machines: { readPage: world.readPage, probe: world.probe },
    });

    // The bound root is addressed by its absolute Machine path, not by its
    // locator and not as a host path.
    if (part === undefined) throw new Error('the accepted turn loaded nothing');
    expect(world.probed).toEqual([{ name: MACHINE, path: ROOT }]);
    expect(blockPaths(part)).toEqual([locator(`${ROOT}/AGENTS.md`)]);
  });

  it('treats a Machine entry as a Machine trigger', async () => {
    const world = machineWorld({
      roots: [ROOT],
      files: { [`${ROOT}/AGENTS.md`]: 'shop rules\n' },
    });
    const { producer, staged, prepare } = attemptOf({ machines: world });

    producer.observeToolCall?.({
      toolName: 'enter_workspace',
      input: { path: locator(ROOT) },
      workspaceRoot: undefined,
      result: { status: 'success', state: 'switched', root: locator(ROOT) },
    });
    await prepare();

    expect(world.probed).toEqual([{ name: MACHINE, path: ROOT }]);
    expect(blockPaths(lastStaged(staged))).toEqual([
      locator(`${ROOT}/AGENTS.md`),
    ]);
  });

  it('projects a relative Machine path against the Machine Workspace root', async () => {
    const world = machineWorld({
      roots: [ROOT],
      files: {
        [`${ROOT}/AGENTS.md`]: 'shop rules\n',
        [`${ROOT}/src/AGENTS.md`]: 'src rules\n',
        [`${ROOT}/src/app.ts`]: 'app\n',
      },
    });
    const { producer, staged, prepare } = attemptOf({ machines: world });

    producer.observeToolCall?.(
      machineCall('src/app.ts', 'read', locator(ROOT)),
    );
    await prepare();

    expect(world.probed).toEqual([
      { name: MACHINE, path: `${ROOT}/src/app.ts` },
    ]);
    expect(blockPaths(lastStaged(staged))).toEqual([
      locator(`${ROOT}/AGENTS.md`),
      locator(`${ROOT}/src/AGENTS.md`),
    ]);
  });

  it('loads a Machine file its own import names, on that Machine', async () => {
    const world = machineWorld({
      roots: [ROOT],
      files: {
        [`${ROOT}/AGENTS.md`]: '@src/rules.md\n',
        [`${ROOT}/src/rules.md`]: 'rule one\n',
        [`${ROOT}/src/AGENTS.md`]: 'src rules\n',
        [`${ROOT}/src/app.ts`]: 'app\n',
      },
    });
    const { producer, staged, prepare } = attemptOf({ machines: world });

    producer.observeToolCall?.(machineCall(locator(`${ROOT}/src/app.ts`)));
    await prepare();

    const part = lastStaged(staged);
    expect(blockPaths(part)).toEqual([
      locator(`${ROOT}/AGENTS.md`),
      locator(`${ROOT}/src/rules.md`),
      locator(`${ROOT}/src/AGENTS.md`),
    ]);
    expect(importedBy(part)).toEqual([
      undefined,
      locator(`${ROOT}/AGENTS.md`),
      undefined,
    ]);
    expect(world.reads.every((read) => read.startsWith('machine://'))).toBe(
      true,
    );
  });

  it('ignores a Machine listing, a roots listing, and a malformed locator', async () => {
    const world = machineWorld({
      roots: [ROOT],
      files: { [`${ROOT}/AGENTS.md`]: 'shop rules\n' },
    });
    const { producer, staged, prepare } = attemptOf({ machines: world });

    for (const path of [
      'machine://',
      `machine://${MACHINE}`,
      'machine://Dev_L/x',
    ]) {
      producer.observeToolCall?.(machineCall(path));
    }
    await prepare();

    expect(staged).toEqual([]);
    expect(world.probed).toEqual([]);
    expect(world.reads).toEqual([]);
  });

  it('loads nothing, and probes nothing, for an unavailable Machine', async () => {
    const world = machineWorld({
      roots: [ROOT],
      files: { [`${ROOT}/AGENTS.md`]: 'shop rules\n' },
      answers: false,
    });
    const { producer, staged, prepare } = attemptOf({ machines: world });

    producer.observeToolCall?.(machineCall(locator(`${ROOT}/x.ts`)));
    await prepare();

    expect(staged).toEqual([]);
    expect(world.reads).toEqual([]);
    // The reachability verdict decides once: not even the root list is asked.
    expect(world.connector.recorded).toEqual([]);
  });
});
