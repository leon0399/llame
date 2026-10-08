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
 *
 * The accepted turn resolves the bound Workspace root (when there is one) and
 * each prompt import's admitted local target together, as one bundle: an
 * import triggers like a native `read` of its path, with no binding required,
 * and names the file it read, so importing an instruction file does not by
 * itself load it.
 */

import { posix } from 'node:path';

import {
  parsePathScheme,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';
import { isRecord, isString } from '@workspace/runtime-safety';

import { compareCodePoints } from '../canonical-json';
import type { AuthoredContextItemPart } from '../chats/context-item';
import { createInstructionsItem } from '../chats/instructions-item';
import {
  KNOWLEDGE_LOCATOR_SCHEME,
  parseKnowledgeLocator,
} from '../knowledge/knowledge-locator';
import { isKnowledgeSpaceId } from '../knowledge/knowledge-filesystem-validation';
import { spaceInstructionScope } from '../knowledge/knowledge-instruction-probe';
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
  hostInstructionScope,
  selectCandidates,
  touchedPath,
  walkFrom,
  type InstructionScope,
} from './instruction-files';
import {
  collectInstructionCandidate,
  type InstructionImportCollector,
  type InstructionImportGroup,
  type InstructionImportState,
} from './instruction-imports';

/** The tool ids whose input names a local path to load for. */
const FILE_TOOL_IDS: ReadonlyArray<string> = [
  nativeReadTool.id,
  nativeEditTool.id,
  nativeWriteTool.id,
];

/** Where one trigger's world is: a host path or a Space-relative path. */
interface TriggerTarget {
  /** The touched path in that world; `''` is a Space's own directory. */
  readonly key: string;
  /** The `kb://` trigger's Space; absent for a host path. */
  readonly space?: SpaceTrigger;
}

/**
 * One `kb://` trigger's Space. Only the canonical lower-case id — the form
 * llame itself formats and shows — ever forms a trigger, so one Space is one
 * group, one set of item labels, one seen key, and one read spelling, and a
 * `read` rule is evaluated for every candidate under exactly the locator the
 * model wrote.
 */
interface SpaceTrigger {
  readonly id: string;
}

/** One pending trigger: the path it touches, and whether a read named it. */
interface PendingTrigger extends TriggerTarget {
  /**
   * A read disclosed the file it named, so that file is not loaded (D5). Only
   * a trigger that can name a file sets it: a directory trigger — an entry or
   * an accepted turn's bound root — discloses nothing, so it carries none.
   */
  readonly excludeCandidate?: boolean;
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
  return { key: posix.resolve(splitSelectorSuffix(selectorPath).path) };
}

/**
 * One `kb://` locator as a Space and a Space-relative key: the selector is
 * dropped, the path is percent-decoded, and only a locator the parser admits
 * names anything. A Space id that is not already canonical is not a trigger at
 * all — the model's own read of it still runs, it just loads no instructions —
 * so every other step of one Space resolves under the single spelling that can
 * reach this point.
 */
function spaceTarget(rest: string): TriggerTarget | undefined {
  const parsed = parseKnowledgeLocator(rest);
  if ('type' in parsed) return undefined;
  if (!isKnowledgeSpaceId(parsed.knowledgeSpaceId)) return undefined;
  if (parsed.knowledgeSpaceId !== parsed.knowledgeSpaceId.toLowerCase()) {
    return undefined;
  }
  return {
    space: { id: parsed.knowledgeSpaceId },
    key: parsed.relativePath ?? '',
  };
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
  return root === undefined ? undefined : { key: root };
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
 * The trusted capabilities one attempt may read candidates through: a world
 * absent from this record may not load at all, so its triggers are ignored
 * before any filesystem is probed.
 */
type AttemptWorlds = Pick<
  InRunAttempt,
  'readPage' | 'knowledge' | 'admitsRead'
>;

/** One Space's triggers in a step. */
interface SpaceTriggers {
  readonly triggers: Array<PendingTrigger>;
}

/** The trigger set's host triggers and each Space's own, in first-mention order. */
interface TriggerPartition {
  readonly onHost: Array<PendingTrigger>;
  readonly bySpace: Map<string, SpaceTriggers>;
}

/** Splits a step's triggers into the host world and one group per Space. */
function partitionTriggers(
  triggers: ReadonlyArray<PendingTrigger>,
): TriggerPartition {
  const bySpace = new Map<string, SpaceTriggers>();
  const onHost: Array<PendingTrigger> = [];
  for (const trigger of triggers) {
    const space = trigger.space;
    if (space === undefined) {
      onHost.push(trigger);
      continue;
    }
    const owned = bySpace.get(space.id);
    if (owned === undefined) {
      bySpace.set(space.id, { triggers: [trigger] });
    } else {
      owned.triggers.push(trigger);
    }
  }
  return { onHost, bySpace };
}

/**
 * The worlds one trigger set resolves into, host first and then each Space in
 * the order its first trigger named it. A world without its trusted capability
 * — no native executor, no configured Knowledge root, a Space that is not the
 * owner's — contributes nothing, so no filesystem is probed for it.
 */
async function resolveGroups(input: {
  readonly triggers: ReadonlyArray<PendingTrigger>;
  readonly worlds: AttemptWorlds;
}): Promise<Array<InstructionImportGroup>> {
  const { onHost, bySpace } = partitionTriggers(input.triggers);
  const groups: Array<InstructionImportGroup> = [];
  const hostPage = input.worlds.readPage;
  if (hostPage !== undefined) {
    const scope = hostInstructionScope();
    groups.push({
      scope,
      page: hostPage,
      admitsRead: input.worlds.admitsRead,
      directories: await resolveDirectories(onHost, scope),
      knowledge: false,
    });
  }
  const knowledge = input.worlds.knowledge;
  if (knowledge === undefined) return groups;
  for (const [spaceId, owned] of bySpace) {
    const space = await knowledge.probe(spaceId);
    if (space === undefined) continue;
    const scope = spaceInstructionScope({
      knowledgeSpaceId: spaceId,
      space,
    });
    groups.push({
      scope,
      page: knowledge.readPage,
      admitsRead: input.worlds.admitsRead,
      directories: await resolveDirectories(owned.triggers, scope),
      knowledge: true,
    });
  }
  return groups;
}

/**
 * Every directory one group walks, broadest first and once each. A key's
 * segment count is its depth in both worlds — an absolute host key counts one
 * segment more than it has, every Space key counts exactly its depth — so
 * counting segments orders both; code points break the one tie a world's own
 * root has with its top-level directories.
 */
function walkOrder(group: InstructionImportGroup): Array<string> {
  const walked = new Set<string>();
  for (const directory of group.directories.keys()) {
    for (const entry of walkFrom(group.scope.root, directory)) {
      walked.add(entry);
    }
  }
  return [...walked].sort(
    (left, right) =>
      left.split('/').length - right.split('/').length ||
      compareCodePoints(left, right),
  );
}

/** Loads every candidate the trigger set resolves to; undefined when none loaded. */
async function loadBundle(input: {
  readonly runId: string;
  readonly triggers: ReadonlyArray<PendingTrigger>;
  readonly worlds: AttemptWorlds;
  /** The attempt's seen keys; each file is added as it loads. */
  readonly keys: Set<string>;
  readonly abortSignal: AbortSignal | undefined;
}): Promise<AuthoredContextItemPart | undefined> {
  const collector: InstructionImportCollector = {
    keys: input.keys,
    attempted: new Set<string>(),
    files: [],
    denied: [],
  };
  for (const group of await resolveGroups({
    triggers: input.triggers,
    worlds: input.worlds,
  })) {
    const state: InstructionImportState = {
      collector,
      group,
      disclosed: group.directories,
      abortSignal: input.abortSignal,
    };
    await loadGroup(state);
  }
  if (collector.files.length === 0) return undefined;
  return createInstructionsItem({
    runId: input.runId,
    files: collector.files,
    denied: collector.denied,
  });
}

/** Loads one world's chain into the shared collector, broadest directory first. */
async function loadGroup(state: InstructionImportState): Promise<void> {
  const { group } = state;
  for (const directory of walkOrder(group)) {
    // The exclusions of one directory, never those of another: a sibling
    // directory whose candidate is the same canonical file still loads it.
    const disclosed = group.directories.get(directory) ?? new Set<string>();
    const candidates = await selectCandidates(group.scope, directory);
    for (const candidate of candidates) {
      // An aborted Run stops loading at the next candidate instead of walking
      // a whole chain to the filesystem root.
      state.abortSignal?.throwIfAborted();
      await collectInstructionCandidate(state, candidate, disclosed, {
        hop: 0,
      });
    }
  }
}

/** One attempt's pending triggers and seen keys; discarded with the attempt. */
function createAttemptProducer(attempt: InRunAttempt): InRunAttemptProducer {
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
        worlds: attempt,
        keys,
        abortSignal: attempt.abortSignal,
      });
      if (part === undefined) return;
      step.stage(part);
    },
  };
}

/**
 * The accepted turn's triggers: the bound root's directory load, when bound,
 * then each prompt import's local target as a native `read` of that path —
 * which names the file it read, so importing an instruction file neither
 * loads nor marks it by itself.
 */
function turnTriggers(context: InRunTurnContext): Array<PendingTrigger> {
  const triggers: Array<PendingTrigger> =
    context.workspaceRoot === undefined ? [] : [{ key: context.workspaceRoot }];
  for (const imported of context.promptImportTriggers ?? []) {
    triggers.push({ ...imported, excludeCandidate: true });
  }
  return triggers;
}

/** The `instructions` producer: stateless between attempts (see the module doc). */
export function createInstructionsProducer(): InRunContextProducer {
  return {
    async prepareTurn(
      context: InRunTurnContext,
    ): Promise<AuthoredContextItemPart | undefined> {
      const triggers = turnTriggers(context);
      if (triggers.length === 0) return undefined;
      return loadBundle({
        runId: context.runId,
        triggers,
        // An accepted turn may carry the host and Knowledge capabilities
        // together; a world without its capability loads nothing, so a
        // trigger of that world is ignored before any filesystem is probed.
        worlds: context,
        // The caller derives the turn's seen set from the returned item, so
        // this set is a scratch guard for the walk: the turn's seen keys plus
        // every canonical path the load collects, so no candidate is read
        // twice.
        keys: new Set(context.seenKeys),
        abortSignal: context.abortSignal,
      });
    },

    beginAttempt(attempt: InRunAttempt): InRunAttemptProducer {
      // An attempt with no page reader for any world it may load in — the
      // `read` tool, the native executor, and the Knowledge root all absent —
      // resolves no world at all, so its triggers load nothing.
      return createAttemptProducer(attempt);
    },
  };
}
