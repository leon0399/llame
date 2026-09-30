/**
 * The `instructions` producer (workspace instruction files D3–D10).
 *
 * Every trigger resolves the same way: the candidate chains from the
 * filesystem root down to the touched directory, minus the files the attempt's
 * effective context and its own items already named, read through the native
 * `read` tool under the Run's own permission decision and audit trail, and
 * staged as one item for the next model step — or, for the accepted turn of a
 * bound Chat, for its first request.
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
  parsePathScheme,
  splitSelectorSuffix,
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
  InRunTurnContext,
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
  readInstructionFile,
  selectCandidates,
  touchedPath,
  walkDirectories,
  type InstructionCandidate,
  type ReadPage,
  type StatHostPath,
} from './instruction-files';

/** The tool ids whose input names a local path to load for. */
const FILE_TOOL_IDS: ReadonlyArray<string> = [
  nativeReadTool.id,
  nativeEditTool.id,
  nativeWriteTool.id,
];

/** One pending trigger: an absolute local path, and whether a read named it. */
interface PendingTrigger {
  readonly path: string;
  /** A read disclosed the file it named, so that file is not loaded (D5). */
  readonly excludeCandidate: boolean;
}

/** The whole read budget of one trigger set, collected as it loads. */
interface BundleCollector {
  /** The attempt's seen keys, plus every canonical path loaded so far. */
  readonly keys: Set<string>;
  readonly files: Array<LoadedInstructionFile>;
  readonly denied: Array<string>;
}

/**
 * The absolute local path one native file tool's input names, projected the way
 * the tool itself projects it: a `file:` alias decodes, a scheme locator is not
 * local, and a relative path resolves against the Workspace root in effect for
 * the call — with no root bound there is nothing to resolve. Every branch
 * normalizes the result with `posix.resolve`, so `.` and `..` segments cannot
 * walk a directory the path merely spells or bypass the candidate exclusion.
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
    return alias.ok
      ? posix.resolve(splitSelectorSuffix(alias.hostPath).path)
      : undefined;
  }
  if (parsePathScheme(path) !== undefined) return undefined;
  if (!isWorkspaceRelative(path)) {
    return posix.resolve(splitSelectorSuffix(path).path);
  }
  return input.root === undefined
    ? undefined
    : splitSelectorSuffix(resolveWorkspacePath(input.root, path)).path;
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
  /** A trigger that named no file loads the directory's whole chain. */
  plainTouch: boolean;
  /** Canonical paths this step's own reads already disclosed to the model. */
  readonly disclosedCanonicalPaths: Set<string>;
}

/** The directories the pending triggers resolve to, and their exclusions. */
async function resolveDirectories(
  triggers: ReadonlyArray<PendingTrigger>,
  stat: StatHostPath,
): Promise<Map<string, ReadonlySet<string>>> {
  const pending = new Map<string, PendingDirectory>();
  for (const trigger of triggers) {
    const touched = await touchedPath(trigger.path, stat);
    const entry = pending.get(touched.directory) ?? {
      plainTouch: false,
      disclosedCanonicalPaths: new Set<string>(),
    };
    pending.set(touched.directory, entry);
    // A read of an existing file neither loads nor marks that file, compared by
    // canonical path, so a link the model read under another name discloses the
    // candidate it resolves to; other candidates in the directory still load.
    // An edit, a write, an entry, or a read of a directory or missing path
    // clears these exclusions and loads the directory's whole chain.
    if (trigger.excludeCandidate && touched.canonicalPath !== undefined) {
      entry.disclosedCanonicalPaths.add(touched.canonicalPath);
    } else {
      entry.plainTouch = true;
    }
  }
  const resolved = new Map<string, ReadonlySet<string>>();
  for (const [directory, entry] of pending) {
    resolved.set(
      directory,
      entry.plainTouch ? new Set<string>() : entry.disclosedCanonicalPaths,
    );
  }
  return resolved;
}

/** Every directory the resolved triggers walk, broadest first and once each. */
function walkOrder(
  directories: ReadonlyMap<string, ReadonlySet<string>>,
): Array<string> {
  const walked = new Set<string>();
  for (const directory of directories.keys()) {
    for (const walkedDirectory of walkDirectories(directory)) {
      walked.add(walkedDirectory);
    }
  }
  return [...walked].sort(
    (left, right) =>
      left.split('/').length - right.split('/').length ||
      compareCodePoints(left, right),
  );
}

/** Reads one candidate into the collector, unless it is disclosed or seen. */
async function collectCandidate(
  collector: BundleCollector,
  candidate: InstructionCandidate,
  disclosed: ReadonlySet<string>,
  readPage: ReadPage,
): Promise<void> {
  if (collector.keys.has(candidate.canonicalPath)) return;
  if (disclosed.has(candidate.canonicalPath)) return;
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
  /** The attempt's seen keys; each file is added as it loads. */
  readonly keys: Set<string>;
  readonly abortSignal: AbortSignal | undefined;
}): Promise<AuthoredContextItemPart | undefined> {
  const directories = await resolveDirectories(input.triggers, statHostPath);
  const collector: BundleCollector = {
    keys: input.keys,
    files: [],
    denied: [],
  };
  for (const directory of walkOrder(directories)) {
    // The exclusions of one directory, never those of another: a sibling
    // directory whose candidate is the same canonical file still loads it.
    const disclosed = directories.get(directory) ?? new Set<string>();
    const candidates = await selectCandidates(directory, statHostPath);
    for (const candidate of candidates) {
      // An aborted Run stops loading at the next candidate instead of walking
      // a whole chain to the filesystem root.
      input.abortSignal?.throwIfAborted();
      await collectCandidate(collector, candidate, disclosed, input.readPage);
    }
  }
  if (collector.files.length === 0) return undefined;
  return createInstructionsItem({
    runId: input.runId,
    files: collector.files,
    denied: collector.denied,
  });
}

/** One attempt's pending triggers and seen keys; discarded with the attempt. */
function createAttemptProducer(
  attempt: InRunAttempt,
  readPage: ReadPage,
): InRunAttemptProducer {
  const keys = new Set(attempt.seenKeys);
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
      const part = await loadBundle({
        runId: attempt.runId,
        triggers,
        readPage,
        keys,
        abortSignal: attempt.abortSignal,
      });
      if (part === undefined) return;
      step.stage(part);
    },
  };
}

/** The `instructions` producer: stateless between attempts (see the module doc). */
export function createInstructionsProducer(): InRunContextProducer {
  return {
    async prepareTurn(
      context: InRunTurnContext,
    ): Promise<AuthoredContextItemPart | undefined> {
      return loadBundle({
        runId: context.runId,
        triggers: [{ path: context.workspaceRoot, excludeCandidate: false }],
        readPage: context.readPage,
        // The caller derives the turn's seen set from the returned item, so
        // this set is a scratch guard for the walk: the turn's seen keys plus
        // every canonical path the load collects, so no candidate is read
        // twice.
        keys: new Set(context.seenKeys),
        abortSignal: context.abortSignal,
      });
    },

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
