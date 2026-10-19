/**
 * The Machine instruction world (remote-machines spec "Machine instruction
 * files are discovered within the containing root"): one Machine target's
 * candidate chain, discovered from the registered root that contains the
 * target down to the target itself, through the Machine.
 *
 * A Machine world is addressed by the same `InstructionScope` contract every
 * other world is (`instruction-files.ts`): `probe` and `list` are the Machine's
 * own `fs.stat` and `fs.list`, and the page reader stays the Run's audited
 * `read`. Its `root` is the registered root the target lies under — the
 * broadest directory a chain from this target may walk — and its keys are
 * addresses on the Machine: the absolute Machine path of an entry, with the
 * empty key naming the registered root itself, exactly as a Space's empty key
 * names the Space's own directory. `walkFrom(scope.root, key)` therefore walks
 * from that root down to the touched directory and never above it, so an
 * `/home/me/AGENTS.md` above a registered `/home/me/shop` is never probed,
 * listed, or read.
 *
 * Which directories are roots is the Machine's own answer (`roots.list`), never
 * the hub's guess: the probe resolves a Machine's roots once per probe instance
 * and reuses them, and a target no registered root contains names no chain at
 * all, so its triggers load nothing. The daemon's own root enforcement stays
 * the authority on what may be read; the root chosen here only bounds the walk.
 *
 * Every call crosses an untrusted boundary and may fail. An unavailable
 * Machine, a refused request, an answer that is not the shape the protocol
 * promises, and a probe that throws all read as "nothing here" — a missing
 * entry, an empty directory — never as an error the Run has to handle:
 * instruction loading is best-effort context, and a Machine that cannot answer
 * simply contributes no files.
 */

import { posix } from 'node:path';

import {
  FS_LIST_METHOD,
  FS_STAT_METHOD,
  ROOTS_LIST_METHOD,
  type JsonValue,
  type RequestEnvelope,
} from '@workspace/machine-protocol';

import type { MachineConnector } from '../machines/machine-connector.service';
import { formatMachineLocator } from '../machines/machine-locator';
import {
  isNativeFailure,
  readFsListResult,
  readFsStatResult,
  readRootsListResult,
} from '../machines/machine-results';
import { machineAttemptKey } from '../runs/machine-attempt';

import { type InstructionScope } from './instruction-files';

/**
 * The registered-root view of one Machine target: the scope its chain is walked
 * in, or undefined when this target names no registered root — an unknown,
 * unreachable, or unconfigured Machine, or a path above or beside every root.
 * Never throws.
 */
export type MachineInstructionProbe = (input: {
  readonly name: string;
  /** The absolute Machine path of the trigger. */
  readonly path: string;
}) => Promise<InstructionScope | undefined>;

/**
 * The probe one attempt loads Machine instruction files through. The Machine's
 * reachability verdict and its root list are decided once per Machine per probe
 * instance — one attempt, one Machine identity — so a chain walk costs one
 * verdict and one `roots.list`, not one of each per trigger.
 *
 * The envelope is the durable identity and the budget of every request this
 * probe makes; the caller builds it with `machineEnvelope`, exactly as a tool
 * call does, so a Machine measures one attempt rather than one caller.
 */
export function createMachineInstructionProbe(input: {
  readonly connector: MachineConnector;
  readonly envelope: RequestEnvelope;
  readonly signal?: AbortSignal;
}): MachineInstructionProbe {
  const attemptKey = machineAttemptKey(
    input.envelope.runId ?? '',
    input.envelope.deliverySeq,
  );
  const roots = new Map<string, Promise<ReadonlyArray<string> | undefined>>();

  /**
   * One Machine's roots, cached for this probe's lifetime: a Machine that could
   * not answer is not asked again, so one unreachable Machine costs one
   * timeout per attempt rather than one per instruction trigger.
   */
  const rootsOf = (
    name: string,
  ): Promise<ReadonlyArray<string> | undefined> => {
    const cached = roots.get(name);
    if (cached !== undefined) return cached;
    const pending = loadRoots({ ...input, attemptKey, name });
    roots.set(name, pending);
    return pending;
  };

  return async ({ name, path }) => {
    const registered = await rootsOf(name);
    if (registered === undefined) return undefined;
    // The path grammar is absolute; anything else contains no root.
    const target = path.startsWith('/') ? posix.resolve(path) : path;
    const root = containingRoot(registered, target);
    if (root === undefined) return undefined;
    return machineInstructionScope({
      name,
      root,
      // The scope asks with the probe's own identity, signal, and budget.
      ask: (method, absolutePath) =>
        ask({ ...input, name, method, path: absolutePath }),
    });
  };
}

/** One Machine request's bound identity: where it goes and who it is. */
type MachineCall = {
  readonly connector: MachineConnector;
  readonly envelope: RequestEnvelope;
  readonly signal?: AbortSignal;
  readonly name: string;
};

/**
 * One Machine's registered roots, or undefined when it cannot answer: a Machine
 * the operator did not configure, an unreachable one, a refused request, and an
 * answer the protocol does not promise are all "no roots".
 */
async function loadRoots(
  input: MachineCall & { readonly attemptKey: string },
): Promise<ReadonlyArray<string> | undefined> {
  try {
    if (
      !input.connector.enabled() ||
      !input.connector.isConfigured(input.name)
    ) {
      return undefined;
    }
    // Reachability is one verdict per attempt: an unreachable Machine must not
    // make every instruction trigger wait out a connect timeout.
    if (!(await input.connector.reachable(input.name, input.attemptKey))) {
      return undefined;
    }
    const answer = await input.connector.request(
      input.name,
      ROOTS_LIST_METHOD,
      { envelope: input.envelope },
      { signal: input.signal },
    );
    return readRootsListResult(answer)?.roots;
  } catch {
    return undefined;
  }
}

/** One untrusted Machine answer for one absolute path, or undefined. */
async function ask(
  input: MachineCall & {
    readonly method: typeof FS_STAT_METHOD | typeof FS_LIST_METHOD;
    readonly path: string;
  },
): Promise<JsonValue | undefined> {
  try {
    return await input.connector.request(
      input.name,
      input.method,
      { envelope: input.envelope, path: input.path },
      { signal: input.signal },
    );
  } catch {
    return undefined;
  }
}

/**
 * One registered root as an instruction scope, addressed on its Machine: keys
 * are absolute Machine paths inside the root (`''` is the root itself), the
 * label of an entry is its canonical Machine locator, and identity is the
 * locator of the path the Machine resolved, so a link collapses to its target
 * exactly as a host realpath does.
 */
function machineInstructionScope(input: {
  readonly name: string;
  readonly root: string;
  readonly ask: (
    method: typeof FS_STAT_METHOD | typeof FS_LIST_METHOD,
    path: string,
  ) => Promise<JsonValue | undefined>;
}): InstructionScope {
  const { name, root } = input;
  return {
    root,
    label: (key) => machineLabel(name, root, key),
    probe: async (key) => {
      const absolute = absoluteKey(root, key);
      const answer = await input.ask(FS_STAT_METHOD, absolute);
      const stat = answer === undefined ? undefined : readFsStatResult(answer);
      if (
        stat === undefined ||
        (stat.kind !== 'file' && stat.kind !== 'directory')
      ) {
        // A missing entry, a link outside the roots, a device, an answer that
        // is not the promised shape, and a refusal are one thing to a chain:
        // there is no candidate and no directory here.
        return { kind: 'missing' };
      }
      return {
        kind: stat.kind,
        size: stat.size ?? 0,
        canonicalPath: machineLabel(name, root, stat.realPath ?? absolute),
      };
    },
    list: async (key) => {
      // `fs.list` answers a refusal as a result, and the call itself may fail;
      // either way the directory holds nothing this chain can select.
      const answer = await input.ask(FS_LIST_METHOD, absoluteKey(root, key));
      const listed =
        answer === undefined ? undefined : readFsListResult(answer);
      if (listed === undefined || isNativeFailure(listed)) return [];
      return listed.entries.map((entry) => entry.name);
    },
  };
}

/**
 * The canonical locator of one key inside one registered root. A registered
 * root is always a valid locator path, so the absolute path is only the
 * fallback for the grammar's own refusal — a spelling no configuration can
 * produce.
 */
function machineLabel(name: string, root: string, key: string): string {
  const absolute = absoluteKey(root, key);
  return formatMachineLocator(name, absolute) ?? absolute;
}

/**
 * One scope key as the absolute Machine path it addresses. A Machine world's
 * keys are absolute Machine paths — every trigger it is walked from carries
 * one — while the empty key names the registered root itself, exactly as a
 * Space's empty key names the Space: it joins the root as a directory with
 * nothing after its separator. A trailing separator names the same directory
 * as its absence, so it is dropped and one entry cannot be addressed two ways.
 */
function absoluteKey(root: string, key: string): string {
  const absolute = key.startsWith('/')
    ? key
    : root.endsWith('/')
      ? `${root}${key}`
      : `${root}/${key}`;
  return absolute.length > 1 && absolute.endsWith('/')
    ? absolute.slice(0, -1)
    : absolute;
}

/**
 * The registered root that contains `target`, or undefined when none does. The
 * longest match wins: a Machine may register a directory inside another one,
 * and the chain must start at the most specific bound, so a nested registered
 * root never exposes its own ancestor.
 */
function containingRoot(
  registered: ReadonlyArray<string>,
  target: string,
): string | undefined {
  let best: string | undefined;
  for (const root of registered) {
    // A registered root is a canonical realpath; a trailing separator names
    // the same directory and would only break the prefix test below.
    const canonical =
      root.length > 1 && root.endsWith('/') ? root.slice(0, -1) : root;
    const contained =
      target === canonical ||
      target.startsWith(canonical.endsWith('/') ? canonical : `${canonical}/`);
    if (!canonical.startsWith('/') || !contained) continue;
    if (best === undefined || canonical.length > best.length) best = canonical;
  }
  return best;
}
