/**
 * Every trigger resolves the same way: the candidate chains from the root of
 * the world it names down to the touched directory, minus the files the
 * attempt's effective context and its own items already named, read through
 * the native `read` tool under the Run's own permission decision and audit
 * trail, and staged as one item for the next model step — or, for the accepted
 * turn of a bound Chat, for its first request.
 *
 * A world is either the host filesystem (keys are absolute paths, walked from
 * `/`) or one Knowledge Space (keys are Space-relative paths, walked from the
 * Space's own directory and never above it). Host files resolve into the same
 * bundle first, then each Space's files, and a Space is labelled and keyed by
 * its logical `kb://` locator, so no host Knowledge path reaches the model.
 *
 * The producer holds no state of its own. An attempt's pending triggers and
 * seen keys live in the object `beginAttempt` returns and are discarded with
 * the attempt, so concurrent Runs on one worker cannot observe each other's
 * work and a failed attempt leaves nothing seen.
 *
 * Triggers are marked by the Run executor through `observeToolCall`: a native
 * `read`/`edit`/`write` whose path names a local file (a `kb://` locator, or a
 * host path with selector, representation suffix, and `file:` alias resolved)
 * at admission, and a settled `enter_workspace` that established or switched
 * the binding. The projection — never the filesystem — happens at observation
 * time, so the Workspace root in effect for the call is the one it is resolved
 * against; the directory probe and the reads happen at the next step.
 */

import { posix } from 'node:path';

import {
  parsePathScheme,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';
import { isRecord, isString } from '@workspace/runtime-safety';

import { compareCodePoints } from '../canonical-json';
import type { AuthoredContextItemPart } from '../chats/context-item';
import {
  createInstructionsItem,
  type LoadedInstructionFile,
} from '../chats/instructions-item';
import {
  KNOWLEDGE_LOCATOR_SCHEME,
  parseKnowledgeLocator,
} from '../knowledge/knowledge-locator';
import { isKnowledgeSpaceId } from '../knowledge/knowledge-filesystem-validation';
import {
  spaceInstructionScope,
  type KnowledgeInstructionProbe,
} from '../knowledge/knowledge-instruction-probe';
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
  directoryDepth,
  hostInstructionScope,
  readInstructionFile,
  selectCandidates,
  touchedPath,
  walkFrom,
  type InstructionCandidate,
  type InstructionScope,
  type ReadPage,
} from './instruction-files';

/** The tool ids whose input names a local path to load for. */
const FILE_TOOL_IDS: ReadonlyArray<string> = [
  nativeReadTool.id,
  nativeEditTool.id,
  nativeWriteTool.id,
];

/** Where one trigger's world is: a host path or a Space-relative path. */
interface TriggerTarget {
  readonly kind: 'host' | 'space';
  /** The touched path in that world; `''` is a Space's own directory. */
  readonly key: string;
  /** A `kb://` trigger's Space; absent for a host path. */
  readonly spaceId?: string;
}

/** One pending trigger: the path it touches, and whether a read named it. */
interface PendingTrigger extends TriggerTarget {
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
 * The one world a native file tool's input names, projected the way the tool
 * itself projects it: a `file:` alias decodes, a `kb://` locator resolves
 * inside its Space, another scheme names no local file, and a relative path
 * resolves against the Workspace root in effect for the call — with no root
 * bound there is nothing to resolve. Every branch normalizes a host path with
 * `posix.resolve`, so `.` and `..` segments cannot walk a directory the path
 * merely spells or bypass the candidate exclusion.
 */
function projectTarget(input: {
  readonly args: unknown;
  readonly root: string | undefined;
}): TriggerTarget | undefined {
  if (!isRecord(input.args)) return undefined;
  const path = input.args['path'];
  if (!isString(path) || path.length === 0) return undefined;
  if (isFileAlias(path)) {
    const alias = decodeFileAlias(path);
    return alias.ok ? hostTarget(alias.hostPath) : undefined;
  }
  const scheme = parsePathScheme(path);
  if (scheme !== undefined) {
    return scheme.scheme === KNOWLEDGE_LOCATOR_SCHEME
      ? spaceTarget(scheme.rest)
      : undefined;
  }
  if (isWorkspaceRelative(path)) {
    return input.root === undefined
      ? undefined
      : hostTarget(resolveWorkspacePath(input.root, path));
  }
  return hostTarget(path);
}

/** One host path, selector and representation suffix split off. */
function hostTarget(selectorPath: string): TriggerTarget {
  return {
    kind: 'host',
    key: posix.resolve(splitSelectorSuffix(selectorPath).path),
  };
}

/**
 * One `kb://` locator as a Space and a Space-relative key: the selector is
 * dropped, the path is percent-decoded, and a traversal or empty segment names
 * nothing. Any other scheme — `skill://`, a web URL — is not a local file.
 */
function spaceTarget(rest: string): TriggerTarget | undefined {
  const parsed = parseKnowledgeLocator(rest);
  if (parsed === undefined || !isKnowledgeSpaceId(parsed.knowledgeSpaceId)) {
    return undefined;
  }
  const relativePath = parsed.relativePath;
  if (relativePath !== undefined && !isContainedSpacePath(relativePath)) {
    return undefined;
  }
  return {
    kind: 'space',
    spaceId: parsed.knowledgeSpaceId,
    key: relativePath ?? '',
  };
}

/** A Space path is a chain of plain names: no traversal, no empty segment. */
function isContainedSpacePath(relativePath: string): boolean {
  return relativePath
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
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
    const target = projectTarget({
      args: call.input,
      root: call.workspaceRoot,
    });
    return target === undefined
      ? undefined
      : { ...target, excludeCandidate: call.toolName === nativeReadTool.id };
  }
  if (call.toolName !== enterWorkspaceTool.id) return undefined;
  const root = enteredRoot(call.result);
  return root === undefined
    ? undefined
    : { kind: 'host', key: root, excludeCandidate: false };
}

/** One directory's pending exclusions, collected across the trigger set. */
interface PendingDirectory {
  /** A trigger that named no file loads the directory's whole chain. */
  plainTouch: boolean;
  /** Canonical paths this step's own reads already disclosed to the model. */
  readonly disclosedCanonicalPaths: Set<string>;
}

/**
 * The directories the pending triggers resolve to in one world, and their
 * exclusions. A read of an existing file neither loads nor marks that file,
 * compared by canonical identity, so a link the model read under another name
 * discloses the candidate it resolves to; other candidates in the directory
 * still load. An edit, a write, an entry, or a read of a directory or missing
 * path clears these exclusions and loads the directory's whole chain.
 */
async function resolveDirectories(
  triggers: ReadonlyArray<PendingTrigger>,
  scope: InstructionScope,
): Promise<Map<string, ReadonlySet<string>>> {
  const pending = new Map<string, PendingDirectory>();
  for (const trigger of triggers) {
    const touched = await touchedPath(scope, trigger.key);
    const entry = pending.get(touched.directory) ?? {
      plainTouch: false,
      disclosedCanonicalPaths: new Set<string>(),
    };
    pending.set(touched.directory, entry);
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

/**
 * The trusted page readers one attempt may read candidates through: a world
 * absent from this record may not load at all, so its triggers are ignored
 * before any filesystem is probed.
 */
interface AttemptPages {
  /** Host candidates, present only with an accepted native executor. */
  readonly host?: ReadPage;
  /** Space candidates, present only with a configured Knowledge root. */
  readonly space?: ReadPage;
  /** The owner-scoped Space view the Space candidates are selected through. */
  readonly knowledge?: KnowledgeInstructionProbe;
}

/** One world a trigger set walks, with the exclusions of each directory. */
interface TriggerGroup {
  readonly scope: InstructionScope;
  readonly page: ReadPage;
  readonly directories: Map<string, ReadonlySet<string>>;
}

/**
 * The worlds one trigger set resolves into, host first and then each Space in
 * the order its first trigger named it. A world without its trusted capability
 * — no native executor, no configured Knowledge root, a Space that is not the
 * owner's — contributes nothing, so no filesystem is probed for it.
 */
async function resolveGroups(input: {
  readonly triggers: ReadonlyArray<PendingTrigger>;
  readonly pages: AttemptPages;
}): Promise<Array<TriggerGroup>> {
  const host = await hostGroup(input.triggers, input.pages.host);
  const spaces = await spaceGroups(input.triggers, input.pages);
  return host === undefined ? spaces : [host, ...spaces];
}

/** The host group, absent when this Run may not load host instruction files. */
async function hostGroup(
  triggers: ReadonlyArray<PendingTrigger>,
  page: ReadPage | undefined,
): Promise<TriggerGroup | undefined> {
  if (page === undefined) return undefined;
  const owned = triggers.filter((trigger) => trigger.kind === 'host');
  if (owned.length === 0) return undefined;
  const scope = hostInstructionScope();
  return { scope, page, directories: await resolveDirectories(owned, scope) };
}

/** One group per Space a trigger named, in first-mention order. */
async function spaceGroups(
  triggers: ReadonlyArray<PendingTrigger>,
  pages: AttemptPages,
): Promise<Array<TriggerGroup>> {
  const { space: page, knowledge } = pages;
  if (page === undefined || knowledge === undefined) return [];
  const groups: Array<TriggerGroup> = [];
  for (const spaceId of spaceIdsOf(triggers)) {
    const owned = triggers.filter(
      (trigger) => trigger.kind === 'space' && trigger.spaceId === spaceId,
    );
    const space = await knowledge(spaceId);
    if (space === undefined) continue;
    const scope = spaceInstructionScope(spaceId, space);
    groups.push({
      scope,
      page,
      directories: await resolveDirectories(owned, scope),
    });
  }
  return groups;
}

/** The Spaces a trigger set names, each once, in first-mention order. */
function spaceIdsOf(
  triggers: ReadonlyArray<PendingTrigger>,
): ReadonlyArray<string> {
  const ids = new Set<string>();
  for (const trigger of triggers) {
    if (trigger.kind === 'space' && trigger.spaceId !== undefined) {
      ids.add(trigger.spaceId);
    }
  }
  return [...ids];
}

/** Every directory one group walks, broadest first and once each. */
function walkOrder(group: TriggerGroup): Array<string> {
  const walked = new Set<string>();
  for (const directory of group.directories.keys()) {
    for (const entry of walkFrom(group.scope.root, directory)) {
      walked.add(entry);
    }
  }
  return [...walked].sort(
    (left, right) =>
      directoryDepth(left) - directoryDepth(right) ||
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
  readonly pages: AttemptPages;
  /** The attempt's seen keys; each file is added as it loads. */
  readonly keys: Set<string>;
  readonly abortSignal: AbortSignal | undefined;
}): Promise<AuthoredContextItemPart | undefined> {
  const collector: BundleCollector = {
    keys: input.keys,
    files: [],
    denied: [],
  };
  for (const group of await resolveGroups({
    triggers: input.triggers,
    pages: input.pages,
  })) {
    await loadGroup(group, collector, input.abortSignal);
  }
  if (collector.files.length === 0) return undefined;
  return createInstructionsItem({
    runId: input.runId,
    files: collector.files,
    denied: collector.denied,
  });
}

/** Loads one world's chain into the shared collector, broadest directory first. */
async function loadGroup(
  group: TriggerGroup,
  collector: BundleCollector,
  abortSignal: AbortSignal | undefined,
): Promise<void> {
  for (const directory of walkOrder(group)) {
    // The exclusions of one directory, never those of another: a sibling
    // directory whose candidate is the same canonical file still loads it.
    const disclosed = group.directories.get(directory) ?? new Set<string>();
    const candidates = await selectCandidates(group.scope, directory);
    for (const candidate of candidates) {
      // An aborted Run stops loading at the next candidate instead of walking
      // a whole chain to the filesystem root.
      abortSignal?.throwIfAborted();
      await collectCandidate(collector, candidate, disclosed, group.page);
    }
  }
}

/** One attempt's pending triggers and seen keys; discarded with the attempt. */
function createAttemptProducer(
  attempt: InRunAttempt,
  pages: AttemptPages,
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
        pages,
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
        triggers: [
          { kind: 'host', key: context.workspaceRoot, excludeCandidate: false },
        ],
        // An accepted turn starts from a bound Workspace root, so only the
        // host world has a directory to walk: no Space is probed for it.
        pages: { host: context.readPage },
        // The caller derives the turn's seen set from the returned item, so
        // this set is a scratch guard for the walk: the turn's seen keys plus
        // every canonical path the load collects, so no candidate is read
        // twice.
        keys: new Set(context.seenKeys),
        abortSignal: context.abortSignal,
      });
    },

    beginAttempt(attempt: InRunAttempt): InRunAttemptProducer {
      const pages = attemptPages(attempt);
      // Without a page reader for any world this Run may load in — the `read`
      // tool, the native executor, or the Knowledge root is absent — no trigger
      // can load anything.
      return pages.host === undefined && pages.space === undefined
        ? { prepareStep: () => {} }
        : createAttemptProducer(attempt, pages);
    },
  };
}

/** The trusted page readers this Run's worlds may read candidates through. */
function attemptPages(attempt: InRunAttempt): AttemptPages {
  return {
    ...(attempt.readPage !== undefined && { host: attempt.readPage }),
    ...(attempt.spaceReadPage !== undefined && {
      space: attempt.spaceReadPage,
      knowledge: attempt.knowledge,
    }),
  };
}
