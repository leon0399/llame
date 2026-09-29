/**
 * The `instructions` producer (workspace instruction files D3–D10).
 *
 * Every trigger resolves the same way: the candidate chains from the
 * filesystem root down to the touched directory, minus the files the attempt's
 * effective context and its own items already named, read through the native
 * `read` tool under the Run's own permission decision and audit trail, and
 * staged as one item for the next model step.
 *
 * The producer holds no state of its own. An attempt's pending triggers and
 * seen keys live in the object `beginAttempt` returns and are discarded with
 * the attempt, so concurrent Runs on one worker cannot observe each other's
 * work and a failed attempt leaves nothing seen.
 *
 * Triggers are marked by the Run executor through `observeToolCall`: a native
 * `read`/`edit`/`write` whose path resolves to a local host path (selector,
 * representation suffix, and `file:` alias included) at admission, and a
 * settled `enter_workspace` that established or switched the binding. The
 * projection — never the filesystem — happens at observation time, so the
 * Workspace root in effect for the call is the one it is resolved against;
 * the directory probe and the reads happen at the next step.
 */

import { posix } from 'node:path';

import {
  isSelectorSuffix,
  parsePathScheme,
  statHostPath,
} from '@workspace/native-file-tools';
import { isRecord, isString } from '@workspace/runtime-safety';

import { compareCodePoints } from '../canonical-json';
import type { AuthoredContextItemPart } from '../chats/context-item';
import {
  createInstructionsItem,
  type LoadedInstructionFile,
} from '../chats/instructions-item';
import type {
  InRunAttempt,
  InRunAttemptProducer,
  InRunContextProducer,
  InRunToolCall,
} from '../runs/in-run-context-items';
import {
  nativeEditTool,
  nativeReadTool,
  nativeWriteTool,
} from '../tools/native-files';
import { decodeFileAlias, isFileAlias } from '../tools/permissions/file-alias';
import type { ToolResult } from '../tools/types';
import { enterWorkspaceTool } from '../tools/workspace';
import {
  isWorkspaceRelative,
  resolveWorkspacePath,
} from '../tools/workspace-path';
import {
  BASE_CHAIN,
  LOCAL_CHAIN,
  readInstructionFile,
  selectCandidates,
  touchedDirectory,
  walkDirectories,
  type InstructionCandidate,
  type ReadPage,
  type StatHostPath,
} from './instruction-files';

/** The nine names a directory may contribute, in chain order. */
const INSTRUCTION_FILE_NAMES: ReadonlyArray<string> = [
  ...BASE_CHAIN,
  ...LOCAL_CHAIN,
];

/** The tool ids whose input names a local path to load for. */
const FILE_TOOL_IDS: ReadonlyArray<string> = [
  nativeReadTool.id,
  nativeEditTool.id,
  nativeWriteTool.id,
];

/** One pending trigger: an absolute local path, and whether a read named it. */
interface PendingTrigger {
  readonly path: string;
  /** A read of a candidate file itself neither loads nor marks that file (D5). */
  readonly excludeCandidate: boolean;
}

/** One directory a trigger set resolves to, and the candidates it disclosed. */
interface TriggerDirectory {
  readonly directory: string;
  readonly excludedPaths: ReadonlySet<string>;
}

/** The whole read budget of one trigger set, collected as it loads. */
interface BundleCollector {
  /** The request's seen keys, plus every canonical path loaded so far. */
  readonly keys: Set<string>;
  readonly files: Array<LoadedInstructionFile>;
  readonly denied: Array<string>;
}

/** The result one trigger set produced, or nothing when it loaded no file. */
interface InstructionBundle {
  readonly part: AuthoredContextItemPart;
  /** Every key the bundle discloses, on top of the request's own. */
  readonly keys: ReadonlyArray<string>;
}

/**
 * Allocates the Run-scoped tool-call id of one audited instruction read. One
 * allocator per Run, so two reads of the same Run never collide in the event
 * log.
 */
export function instructionReadIds(runId: string): () => string {
  let ordinal = 0;
  return () => {
    ordinal += 1;
    return `instructions-${runId}-${ordinal}`;
  };
}

/**
 * The path a native read would open, with any read selector or representation
 * suffix removed: the trigger directory is the one the unselected path names
 * (spec: A ranged read triggers like a plain read).
 */
function withoutSelector(path: string): string {
  const raw = /:raw(?::[^:/]*)?$/u.exec(path);
  if (raw) return path.slice(0, raw.index);
  const outline = /:outline(?::[^:/]*)?$/u.exec(path);
  if (outline) return path.slice(0, outline.index);
  const colon = path.lastIndexOf(':');
  if (
    colon > path.lastIndexOf('/') &&
    isSelectorSuffix(path.slice(colon + 1))
  ) {
    return path.slice(0, colon);
  }
  return path;
}

/**
 * The absolute local path one native file tool's input names, projected the way
 * the tool itself projects it: a `file:` alias decodes, a scheme locator is not
 * local, and a relative path resolves against the Workspace root in effect for
 * the call — with no root bound there is nothing to resolve.
 */
function projectLocalPath(input: {
  readonly args: unknown;
  readonly root: string | undefined;
}): string | undefined {
  if (!isRecord(input.args)) return undefined;
  const path = input.args['path'];
  if (!isString(path) || path.length === 0) return undefined;
  if (isFileAlias(path)) {
    const alias = decodeFileAlias(path);
    return alias.ok ? withoutSelector(alias.hostPath) : undefined;
  }
  if (parsePathScheme(path) !== undefined) return undefined;
  if (!isWorkspaceRelative(path)) return withoutSelector(path);
  return input.root === undefined
    ? undefined
    : withoutSelector(resolveWorkspacePath(input.root, path));
}

/** The canonical root a successful `enter_workspace` established or switched to. */
function enteredRoot(result: ToolResult | undefined): string | undefined {
  if (result === undefined || result.status !== 'success') return undefined;
  const state = result['state'];
  if (state !== 'bound' && state !== 'switched') return undefined;
  const root = result['root'];
  return isString(root) ? root : undefined;
}

/** The trigger one observed tool call marks, if it marks one at all. */
function observedTrigger(call: InRunToolCall): PendingTrigger | undefined {
  if (FILE_TOOL_IDS.includes(call.toolName)) {
    // A file tool marks at admission; its settled observation repeats the very
    // same call and input, so it adds nothing.
    if (call.result !== undefined) return undefined;
    const path = projectLocalPath({
      args: call.input,
      root: call.workspaceRoot,
    });
    return path === undefined
      ? undefined
      : { path, excludeCandidate: call.toolName === nativeReadTool.id };
  }
  if (call.toolName !== enterWorkspaceTool.id) return undefined;
  const root = enteredRoot(call.result);
  return root === undefined
    ? undefined
    : { path: root, excludeCandidate: false };
}

/** One directory's pending exclusions, collected across the trigger set. */
interface PendingDirectory {
  /** A trigger that named no candidate loads the directory's whole chain. */
  plainTouch: boolean;
  readonly excludedPaths: Set<string>;
}

/** The directories the pending triggers resolve to, in trigger order. */
async function resolveDirectories(
  triggers: ReadonlyArray<PendingTrigger>,
  stat: StatHostPath,
): Promise<Array<TriggerDirectory>> {
  const pending = new Map<string, PendingDirectory>();
  for (const trigger of triggers) {
    const directory = await touchedDirectory(trigger.path, stat);
    const entry = pending.get(directory) ?? {
      plainTouch: false,
      excludedPaths: new Set<string>(),
    };
    pending.set(directory, entry);
    // A read of a candidate file in its own directory neither loads nor marks
    // that file; every other trigger loads the directory's whole chain.
    const disclosed =
      trigger.excludeCandidate &&
      posix.dirname(trigger.path) === directory &&
      INSTRUCTION_FILE_NAMES.includes(posix.basename(trigger.path));
    if (disclosed) entry.excludedPaths.add(trigger.path);
    else entry.plainTouch = true;
  }
  return [...pending].map(([directory, entry]) => ({
    directory,
    excludedPaths: entry.plainTouch ? new Set<string>() : entry.excludedPaths,
  }));
}

/** Every directory the resolved triggers walk, broadest first and once each. */
function walkOrder(
  directories: ReadonlyArray<TriggerDirectory>,
): Array<string> {
  const walked = new Set<string>();
  for (const trigger of directories) {
    for (const directory of walkDirectories(trigger.directory)) {
      walked.add(directory);
    }
  }
  return [...walked].sort(
    (left, right) =>
      left.split('/').length - right.split('/').length ||
      compareCodePoints(left, right),
  );
}

/** Reads one candidate into the collector, unless it is excluded or seen. */
async function collectCandidate(
  collector: BundleCollector,
  candidate: InstructionCandidate,
  excluded: ReadonlySet<string>,
  readPage: ReadPage,
): Promise<void> {
  if (collector.keys.has(candidate.canonicalPath)) return;
  if (excluded.has(candidate.path)) return;
  const read = await readInstructionFile(candidate, readPage);
  if (read.kind === 'denied') {
    collector.denied.push(candidate.path);
    return;
  }
  // An empty candidate ends its chain but discloses nothing: it is neither
  // named to the model nor marked seen (spec: Empty placeholder suppresses
  // later names).
  if (read.kind === 'failed' || read.content.length === 0) return;
  collector.keys.add(candidate.canonicalPath);
  collector.files.push({
    path: candidate.path,
    canonicalPath: candidate.canonicalPath,
    content: read.content,
    truncated: read.truncated,
    omittedBytes: read.omittedBytes,
  });
}

/** Loads every candidate the trigger set resolves to; undefined when none loaded. */
async function loadBundle(input: {
  readonly runId: string;
  readonly triggers: ReadonlyArray<PendingTrigger>;
  readonly readPage: ReadPage;
  readonly seenKeys: ReadonlyArray<string>;
  readonly abortSignal: AbortSignal | undefined;
}): Promise<InstructionBundle | undefined> {
  const directories = await resolveDirectories(input.triggers, statHostPath);
  const excludedByDirectory = new Map(
    directories.map((entry) => [entry.directory, entry.excludedPaths]),
  );
  const collector: BundleCollector = {
    keys: new Set(input.seenKeys),
    files: [],
    denied: [],
  };
  for (const directory of walkOrder(directories)) {
    const excluded = excludedByDirectory.get(directory) ?? new Set<string>();
    const candidates = await selectCandidates(directory, statHostPath);
    for (const candidate of candidates) {
      // An aborted Run stops loading at the next candidate instead of walking
      // a whole chain to the filesystem root.
      input.abortSignal?.throwIfAborted();
      await collectCandidate(collector, candidate, excluded, input.readPage);
    }
  }
  if (collector.files.length === 0) return undefined;
  return {
    part: createInstructionsItem({
      runId: input.runId,
      files: collector.files,
      denied: collector.denied,
    }),
    keys: [...collector.keys],
  };
}

/** One attempt's pending triggers and seen keys; discarded with the attempt. */
function createAttemptProducer(
  attempt: InRunAttempt,
  readPage: ReadPage,
): InRunAttemptProducer {
  const keys = new Set(attempt.seenKeys ?? []);
  let pending: Array<PendingTrigger> = [];
  return {
    observeToolCall(call): void {
      const trigger = observedTrigger(call);
      if (trigger !== undefined) pending.push(trigger);
    },

    async prepareStep(step): Promise<void> {
      if (pending.length === 0) return;
      const triggers = pending;
      pending = [];
      const bundle = await loadBundle({
        runId: attempt.runId,
        triggers,
        readPage,
        seenKeys: [...keys],
        abortSignal: attempt.abortSignal,
      });
      if (bundle === undefined) return;
      for (const key of bundle.keys) keys.add(key);
      step.stage(bundle.part);
    },
  };
}

/** The `instructions` producer: stateless between attempts (see the module doc). */
export function createInstructionsProducer(): InRunContextProducer {
  return {
    beginAttempt(attempt: InRunAttempt): InRunAttemptProducer {
      const readPage = attempt.readPage;
      // Without a page reader the producer may not load at all — the `read`
      // tool or the native executor is absent — so every trigger is a no-op.
      return readPage === undefined
        ? { prepareStep: () => {} }
        : createAttemptProducer(attempt, readPage);
    },
  };
}
