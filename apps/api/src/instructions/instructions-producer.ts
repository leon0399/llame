/**
 * Every trigger resolves the same way: the candidate chains from the root of
 * the world it names down to the touched directory, minus the files the
 * attempt's effective context and its own items already named, read through
 * the native `read` tool under the Run's own permission decision and audit
 * trail, and staged as one item for the next model step — or, for the accepted
 * turn of a bound Chat, for its first request.
 *
 * A world is the host filesystem (keys are absolute paths, walked from `/`),
 * one Knowledge Space (keys are Space-relative paths, walked from the Space's
 * own directory and never above it), or one Machine (keys are absolute Machine
 * paths, walked from the registered root that contains the touched directory
 * and never above it). Host files resolve into the same bundle first, then each
 * Space's files, then each Machine's; a Space is labelled and keyed by its
 * logical `kb://` locator and a Machine file by its canonical `machine://`
 * locator, so no host path reaches the model in either world's place.
 *
 * The producer holds no state of its own. An attempt's pending triggers and
 * seen keys live in the object `beginAttempt` returns and are discarded with
 * the attempt, so concurrent Runs on one worker cannot observe each other's
 * work and a failed attempt leaves nothing seen.
 *
 * Triggers are marked by the Run executor through `observeToolCall`: a native
 * `read`/`edit`/`write` whose path names a file in a world (a `kb://` locator, a
 * `machine://` locator, or a host path with selector, representation suffix, and
 * `file:` alias resolved) at admission, and a settled `enter_workspace` that
 * established or switched the binding, on whichever world's root it bound. The
 * projection — never the filesystem — happens at observation time, so the
 * Workspace root in effect for the call is the one it is resolved against; the
 * directory probe and the reads happen at the next step.
 *
 * The accepted turn resolves the bound Workspace root (when there is one) and
 * each prompt import's admitted local target together, as one bundle: an
 * import triggers like a native `read` of its path, with no binding required,
 * and names the file it read, so importing an instruction file does not by
 * itself load it. That exclusion yields to another trigger whose chain walks
 * through the file's directory, or that touches the same directory without
 * excluding the file.
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
import {
  isMachineLocator,
  parseMachineLocator,
} from '../machines/machine-locator';
import type {
  InRunAttempt,
  InRunAttemptProducer,
  InRunContextProducer,
  InRunToolCall,
  InRunTurnContext,
  PromptImportTrigger,
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
  type TouchedPath,
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

/** One pending trigger: the path it touches, and whether a read named it. */
interface PendingTrigger extends PromptImportTrigger {
  /**
   * A read disclosed the file it named, so that file is not loaded (D5). Only
   * a trigger that can name a file sets it: a directory trigger — an entry or
   * an accepted turn's bound root — discloses nothing, so it carries none.
   */
  readonly excludeCandidate?: boolean;
  /**
   * A prompt import's self-read exclusion holds only while no other trigger
   * walks through its directory or touches that directory without excluding
   * the same file.
   */
  readonly yieldsToWalk?: boolean;
}

/**
 * The one world a native file tool's input names, projected the way the tool
 * itself projects it: a `machine://` locator names a Machine path, a `file:`
 * alias decodes to a host path, a `kb://` locator resolves inside its Space,
 * another scheme names no local file, and a relative path resolves against the
 * Workspace root in effect for the call — with no root bound there is nothing
 * to resolve. Every branch normalizes the path it produces with `posix.resolve`
 * (host and Machine alike), so `.` and `..` segments cannot walk a directory
 * the path merely spells or bypass the candidate exclusion.
 */
function projectTarget(input: {
  readonly args: unknown;
  readonly root: string | undefined;
}): PromptImportTrigger | undefined {
  if (!isRecord(input.args)) return undefined;
  const path = input.args['path'];
  if (!isString(path) || path.length === 0) return undefined;
  if (isMachineLocator(path)) return machineTarget(path);
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
    if (input.root === undefined) return undefined;
    // The root in effect decides the world: a Machine Workspace resolves a
    // relative path on its Machine, a host Workspace on this worker.
    const resolved = resolveWorkspacePath(input.root, path);
    return isMachineLocator(resolved)
      ? machineTarget(resolved)
      : hostTarget(resolved);
  }
  return hostTarget(path);
}

/** One host path, selector and representation suffix split off. */
function hostTarget(selectorPath: string): PromptImportTrigger {
  return { key: posix.resolve(splitSelectorSuffix(selectorPath).path) };
}

/**
 * One `machine://` locator as the Machine it names and the absolute Machine
 * path inside it: the selector is dropped (as for a host path), the decoded
 * path is normalized lexically, and the trigger's key is that absolute path,
 * which is how a Machine world is addressed. Only a locator the parser admits
 * as a path names anything: the listing form, the roots form, and a malformed
 * locator load no instructions at all — the model's own read still runs.
 *
 * Which registered root contains the path — and therefore where the chain
 * starts — is decided inside the probe, the one place the Machine's own answer
 * can be known.
 */
export function machineTarget(
  locator: string,
): PromptImportTrigger | undefined {
  if (!isMachineLocator(locator)) return undefined;
  const parsed = parseMachineLocator(locator);
  if (parsed.kind !== 'path') return undefined;
  const path = posix.resolve(parsed.path);
  return { machine: { name: parsed.name }, key: path };
}

/**
 * One trigger in the world its path names. A trigger that already names its
 * Machine — a Workspace root and a prompt import are both resolved before the
 * producer sees them — is taken as it is, and a path spelled as a Machine
 * locator becomes the Machine trigger a native tool call of it would produce,
 * so a Machine root is never probed as a host path.
 */
function worldTrigger(target: PromptImportTrigger): PromptImportTrigger {
  return target.machine !== undefined
    ? target
    : (machineTarget(target.key) ?? target);
}

/**
 * One `kb://` locator as a Space and a Space-relative key: the selector is
 * dropped, the path is percent-decoded, and only a locator the parser admits
 * names anything. A Space id that is not already canonical is not a trigger at
 * all — the model's own read of it still runs, it just loads no instructions —
 * so every other step of one Space resolves under the single spelling that can
 * reach this point. Only the canonical lower-case id — the form llame itself
 * formats and shows — forms a trigger, so one Space is one group, one set of
 * item labels, one seen key, and one read spelling, and a `read` rule is
 * evaluated for every candidate under exactly the locator the model wrote.
 */
export function spaceTarget(rest: string): PromptImportTrigger | undefined {
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
  // A Machine entry binds a Machine locator, so the bound root's own directory
  // load happens on that Machine, exactly as an entry at a host root does here.
  return root === undefined ? undefined : worldTrigger({ key: root });
}

/** One directory's pending exclusions, collected across the trigger set. */
interface PendingDirectory {
  /** A trigger that named no file loads the directory's whole chain. */
  plainTouch: boolean;
  /** Canonical paths this step's own reads already disclosed to the model. */
  readonly disclosedCanonicalPaths: Set<string>;
}

/** One trigger with the path it touched. */
interface TriggerTouch {
  readonly trigger: PendingTrigger;
  readonly touched: TouchedPath;
}

/** Probes each trigger's path and collects every directory a chain walks through. */
async function touchTriggers(
  triggers: ReadonlyArray<PendingTrigger>,
  scope: InstructionScope,
): Promise<{ touches: Array<TriggerTouch>; walkedThrough: Set<string> }> {
  const touches: Array<TriggerTouch> = [];
  const walkedThrough = new Set<string>();
  for (const trigger of triggers) {
    const touched = await touchedPath(scope, trigger.key);
    touches.push({ trigger, touched });
    for (const directory of walkFrom(scope.root, touched.directory)) {
      if (directory !== touched.directory) walkedThrough.add(directory);
    }
  }
  return { touches, walkedThrough };
}

/**
 * Whether another trigger touches the same directory without excluding the
 * same file, so a prompt import's self-read exclusion yields to it.
 */
function sharesDirectory(
  touches: ReadonlyArray<TriggerTouch>,
  index: number,
): boolean {
  const own = touches[index].touched;
  return touches.some(
    ({ touched }) =>
      touched !== own &&
      touched.directory === own.directory &&
      touched.canonicalPath !== own.canonicalPath,
  );
}

/**
 * The directories the pending triggers resolve to in one world, and their
 * exclusions. A read of an existing file neither loads nor marks that file,
 * compared by canonical identity, so a link the model read under another name
 * discloses the candidate it resolves to; other candidates in the directory
 * still load. An edit, a write, an entry, or a read of a directory or missing
 * path clears these exclusions and loads the directory's whole chain. A
 * trigger that `yieldsToWalk` keeps its exclusion only while no other trigger
 * walks through its directory or touches that directory without excluding the
 * same file.
 */
async function resolveDirectories(
  triggers: ReadonlyArray<PendingTrigger>,
  scope: InstructionScope,
): Promise<Map<string, ReadonlySet<string>>> {
  const { touches, walkedThrough } = await touchTriggers(triggers, scope);
  const pending = new Map<string, PendingDirectory>();
  for (const [index, { trigger, touched }] of touches.entries()) {
    const entry = pending.get(touched.directory) ?? {
      plainTouch: false,
      disclosedCanonicalPaths: new Set<string>(),
    };
    pending.set(touched.directory, entry);
    const walked = walkedThrough.has(touched.directory);
    const yields =
      trigger.yieldsToWalk === true &&
      (walked || sharesDirectory(touches, index));
    const disclosed =
      trigger.excludeCandidate &&
      touched.canonicalPath !== undefined &&
      !yields;
    if (disclosed) {
      entry.disclosedCanonicalPaths.add(touched.canonicalPath);
    }
    const plainTouch = !disclosed && (!yields || walked);
    if (plainTouch) {
      // A prompt import yielding only to a same-directory trigger drops its own
      // exclusion and keeps exclusions native reads set in that directory.
      entry.plainTouch = true;
    }
  }
  return new Map(
    Array.from(pending, ([directory, entry]): [string, ReadonlySet<string>] => [
      directory,
      entry.plainTouch ? new Set<string>() : entry.disclosedCanonicalPaths,
    ]),
  );
}

/**
 * The trusted capabilities one attempt may read candidates through: a world
 * absent from this record may not load at all, so its triggers are ignored
 * before any filesystem is probed.
 */
type AttemptWorlds = Pick<
  InRunAttempt,
  'readPage' | 'knowledge' | 'machines' | 'admitsRead'
>;

/** One world's own triggers in a step. */
interface WorldTriggers {
  readonly triggers: Array<PendingTrigger>;
}

/** The host triggers and each Space's and Machine's own, in first-mention order. */
interface TriggerPartition {
  readonly onHost: Array<PendingTrigger>;
  readonly bySpace: Map<string, WorldTriggers>;
  readonly byMachine: Map<string, WorldTriggers>;
}

/** Appends one trigger to the named world's group, creating it when new. */
function addTrigger(
  groups: Map<string, WorldTriggers>,
  id: string,
  trigger: PendingTrigger,
): void {
  const world = groups.get(id);
  if (world === undefined) {
    groups.set(id, { triggers: [trigger] });
  } else {
    world.triggers.push(trigger);
  }
}

/**
 * Splits a step's triggers into the host world and one group per Space and per
 * Machine. A trigger's own world wins: a Machine trigger names a Machine, a
 * `kb://` trigger a Space, and every other path this worker's filesystem.
 */
function partitionTriggers(
  triggers: ReadonlyArray<PendingTrigger>,
): TriggerPartition {
  const bySpace = new Map<string, WorldTriggers>();
  const byMachine = new Map<string, WorldTriggers>();
  const onHost: Array<PendingTrigger> = [];
  for (const trigger of triggers) {
    const machine = trigger.machine;
    const space = trigger.space;
    if (machine !== undefined) {
      addTrigger(byMachine, machine.name, trigger);
    } else if (space !== undefined) {
      addTrigger(bySpace, space.id, trigger);
    } else {
      onHost.push(trigger);
    }
  }
  return { onHost, bySpace, byMachine };
}

/**
 * The worlds one trigger set resolves into, host first and then each Space and
 * each Machine in the order its first trigger named it. A world without its
 * trusted capability — no native executor, no configured Knowledge root, no
 * Machine capability, a Space that is not the owner's — contributes nothing, so
 * no filesystem is probed for it.
 */
async function resolveGroups(input: {
  readonly triggers: ReadonlyArray<PendingTrigger>;
  readonly worlds: AttemptWorlds;
}): Promise<Array<InstructionImportGroup>> {
  const { onHost, bySpace, byMachine } = partitionTriggers(input.triggers);
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
  if (knowledge !== undefined) {
    groups.push(
      ...(await spaceGroups({
        bySpace,
        knowledge,
        admitsRead: input.worlds.admitsRead,
      })),
    );
  }
  const machines = input.worlds.machines;
  if (machines !== undefined) {
    groups.push(
      ...(await machineGroups({
        byMachine,
        machines,
        admitsRead: input.worlds.admitsRead,
      })),
    );
  }
  return groups;
}

/**
 * One group per Space that resolved for this Run, in the order the triggers
 * named it. A Space that is not the owner's contributes nothing.
 */
async function spaceGroups(input: {
  readonly bySpace: Map<string, WorldTriggers>;
  readonly knowledge: NonNullable<AttemptWorlds['knowledge']>;
  readonly admitsRead: (path: string) => boolean;
}): Promise<Array<InstructionImportGroup>> {
  const groups: Array<InstructionImportGroup> = [];
  for (const [spaceId, owned] of input.bySpace) {
    const space = await input.knowledge.probe(spaceId);
    if (space === undefined) continue;
    const scope = spaceInstructionScope({ knowledgeSpaceId: spaceId, space });
    groups.push({
      scope,
      page: input.knowledge.readPage,
      admitsRead: input.admitsRead,
      directories: await resolveDirectories(owned.triggers, scope),
      knowledge: true,
    });
  }
  return groups;
}

/**
 * One group per registered root a Machine's triggers resolve into, in
 * first-mention order. A Machine may register several roots, and a chain is
 * walked from the root that contains its own target, so triggers under two
 * roots cannot share one scope. The probe decides that root — and answers a
 * Machine's roots once for the whole probe — so a trigger no registered root
 * contains, and every trigger of an unavailable Machine, loads nothing.
 */
async function machineGroups(input: {
  readonly byMachine: Map<string, WorldTriggers>;
  readonly machines: NonNullable<AttemptWorlds['machines']>;
  readonly admitsRead: (path: string) => boolean;
}): Promise<Array<InstructionImportGroup>> {
  const owned = new Map<
    string,
    { scope: InstructionScope; triggers: Array<PendingTrigger> }
  >();
  for (const [name, machine] of input.byMachine) {
    for (const trigger of machine.triggers) {
      const scope = await input.machines.probe({ name, path: trigger.key });
      if (scope === undefined) continue;
      const key = `${name}\u0000${scope.root}`;
      const found = owned.get(key);
      if (found === undefined) {
        owned.set(key, { scope, triggers: [trigger] });
      } else {
        found.triggers.push(trigger);
      }
    }
  }
  const groups: Array<InstructionImportGroup> = [];
  for (const found of owned.values()) {
    groups.push({
      scope: found.scope,
      page: input.machines.readPage,
      admitsRead: input.admitsRead,
      directories: await resolveDirectories(found.triggers, found.scope),
      knowledge: false,
    });
  }
  return groups;
}

/**
 * Every directory one group walks, broadest first and once each. A key's
 * segment count is its depth in every world — a host key and a Machine key are
 * absolute paths, so the world's own root counts one segment more than it has
 * while every Space key counts exactly its depth — so counting segments orders
 * all three; code points break the tie a world's own root has with its
 * top-level directories. A Machine trigger that is the registered root itself
 * (`walkFrom` yields that root alone) sorts before everything below it, exactly
 * as the host root does.
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
 * The accepted turn's triggers: the bound root's directory load, when bound —
 * on the Machine that root names, when the Chat is bound to a Machine — then
 * each prompt import's admitted target as a native `read` of that path, which
 * names the file it read, so importing an instruction file neither loads nor
 * marks it by itself.
 */
function turnTriggers(context: InRunTurnContext): Array<PendingTrigger> {
  const root = context.workspaceRoot;
  const triggers: Array<PendingTrigger> =
    root === undefined ? [] : [worldTrigger({ key: root })];
  for (const imported of context.promptImportTriggers ?? []) {
    triggers.push({
      ...worldTrigger(imported),
      excludeCandidate: true,
      yieldsToWalk: true,
    });
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
