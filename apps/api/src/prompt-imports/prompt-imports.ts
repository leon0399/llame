/**
 * Resolution of the import markers in an owner's prompt (prompt-imports
 * D6-D7). The module decides which markers become audited `read` calls and
 * bounds the work; the caller supplies the ports (admission pre-evaluation,
 * existence probes, the audited read) and persists the result.
 */

import {
  parsePathScheme,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';

import {
  promptImportMedia,
  type PromptImportOutcome,
} from '../chats/prompt-imports-item';
import { KnowledgeFilesystemError } from '../knowledge/knowledge-filesystem';
import { importTargets } from '../import-markers/import-markers';
import { KNOWLEDGE_LOCATOR_SCHEME } from '../knowledge/knowledge-locator';
import {
  formatMachineLocator,
  isMachineLocator,
  parseMachineLocator,
} from '../machines/machine-locator';
import { MEDIA_LOCATOR_SCHEME } from '../media/media-locator';
import { SSH_SCHEME } from '../ssh/ssh-locator';
import { readAcceptsScheme } from '../tools/native-files';
import { decodeFileAlias, isFileAlias } from '../tools/permissions/file-alias';
import type { PermissionDecision } from '../tools/permissions/types';
import { type ToolResult } from '../tools/types';
import { resolveWorkspacePath } from '../tools/workspace-path';

/** Distinct markers considered per prompt; later ones stay prose, unprobed. */
export const MAX_PROMPT_IMPORT_MARKERS = 64;
/** Probe survivors and no-probe targets read per prompt. */
export const MAX_PROMPT_IMPORT_READS = 8;
/** Aggregate UTF-8 bytes of imported bodies. */
export const MAX_PROMPT_IMPORT_BYTES = 128 * 1024;
/** Work budget, probes included. */
export const PROMPT_IMPORT_WORK_MS = 30_000;

/**
 * A Knowledge probe can be cancelled after the resolver has entered the
 * filesystem. It closes this pass without turning the cancellation into a
 * failed import.
 */
export const PROMPT_IMPORT_KNOWLEDGE_CANCELLED = Symbol(
  'prompt-import-knowledge-cancelled',
);

const KNOWLEDGE_PREFIX = `${KNOWLEDGE_LOCATOR_SCHEME}://`;

export type PromptImportRequest = {
  readonly text: string;
  /**
   * Closes on Run abort or when the work budget runs out. In-flight reads run
   * under it, and once it is aborted no further read is issued.
   */
  readonly signal: AbortSignal;
  readonly workspaceRoot: string | undefined;
  readonly hostAvailable: boolean;
  readonly knowledgeAvailable: boolean;
  /** Whether the Run may reach the configured Machines at all. */
  readonly machineAvailable: boolean;
  /** Whether `ssh://` is enabled and `read` allowlisted (ssh-locator D6a). */
  readonly sshAvailable: boolean;
  /** Silent `read`-group pre-evaluation of the exact string the read submits. */
  readonly admitsRead: (path: string) => boolean;
  readonly probeHost: (absolutePathWithoutSelector: string) => Promise<boolean>;
  /**
   * The canonical Machine locator when `path` exists on `name`, and undefined
   * when it does not or the Machine is unreachable alike. `path` is the
   * locator's absolute Machine path, without its read selector — the same
   * selector-free path a local probe confirms.
   */
  readonly probeMachine: (
    name: string,
    path: string,
  ) => Promise<string | undefined>;
  /** The canonical `kb://` locator when the resource exists for the owner. */
  readonly probeKnowledge: (
    locatorWithoutSelector: string,
  ) => Promise<string | undefined | typeof PROMPT_IMPORT_KNOWLEDGE_CANCELLED>;
  /**
   * The canonical `media://` locator when the Run owner stores that image;
   * undefined for an unknown or another owner's id alike.
   */
  readonly probeMedia: (
    locatorWithoutSelector: string,
  ) => Promise<string | undefined>;
  /**
   * One audited read. `ordinal` is the target's position among the distinct
   * markers, so a target keeps its call identity across retries; `locator` is
   * the target as written, its entry's locator, which keys an unstored image
   * in the attempt's memory (vision-media D8). `admission` is the decision the
   * read group reached, absent when the call never got that far.
   */
  readonly readImport: (
    path: string,
    ordinal: number,
    locator: string,
  ) => Promise<{
    result: ToolResult;
    text: string;
    admission: PermissionDecision | undefined;
  }>;
  readonly nowMs: () => number;
};

type PromptImportResolution = {
  outcomes: Array<PromptImportOutcome>;
  omitted: Array<string>;
};

type ImportPlan =
  | { readonly kind: 'direct'; readonly readPath: string }
  | {
      readonly kind: 'host';
      readonly readPath: string;
      /** Decoded absolute host path, selector still attached. */
      readonly hostPath: string;
    }
  | {
      readonly kind: 'machine';
      /** The configured Machine the locator names. */
      readonly name: string;
      /** Decoded absolute Machine path, without the read selector. */
      readonly machinePath: string;
      readonly readPath: string;
    }
  | { readonly kind: 'knowledge'; readonly readPath: string }
  | { readonly kind: 'media'; readonly readPath: string };

type ImportRun = PromptImportResolution & {
  readonly request: PromptImportRequest;
  readonly startedAt: number;
  reads: number;
  bytes: number;
  outputFull: boolean;
  knowledgeProbeCancelled: boolean;
};

/**
 * Resolve, probe, and read the markers of one prompt, in first-occurrence
 * order, inside the count, output, and work bounds.
 */
export async function resolvePromptImports(
  request: PromptImportRequest,
): Promise<PromptImportResolution> {
  const run: ImportRun = {
    request,
    startedAt: request.nowMs(),
    outcomes: [],
    omitted: [],
    reads: 0,
    bytes: 0,
    outputFull: false,
    knowledgeProbeCancelled: false,
  };
  const targets = importTargets(request.text).slice(
    0,
    MAX_PROMPT_IMPORT_MARKERS,
  );
  for (const [ordinal, target] of targets.entries()) {
    try {
      const plan = planTarget(request, target);
      if (plan !== undefined) await handleTarget(run, target, ordinal, plan);
    } catch (error) {
      if (!isKnowledgeCancellation(error)) throw error;
      run.knowledgeProbeCancelled = true;
    }
  }
  return { outcomes: run.outcomes, omitted: run.omitted };
}

/** The read a target would perform, or `undefined` when it stays prose. */
function planTarget(
  request: PromptImportRequest,
  target: string,
): ImportPlan | undefined {
  if (target.startsWith('~/')) return undefined;
  if (isFileAlias(target)) return planFileAlias(request, target);
  if (isMachineLocator(target)) return planMachineTarget(request, target);
  const scheme = parsePathScheme(target);
  if (scheme !== undefined) return planScheme(request, scheme.scheme, target);
  // A bare absolute marker is never re-mapped here: while a Chat is bound to a
  // Machine Workspace the caller projects it, and otherwise it is a host path.
  if (target.startsWith('/')) {
    if (!request.hostAvailable) return undefined;
    return { kind: 'host', readPath: target, hostPath: target };
  }
  const root = request.workspaceRoot;
  if (root === undefined) return undefined;
  // A Machine Workspace root resolves without the local native executor: the
  // relative marker becomes a Machine locator, not a host path.
  if (!request.hostAvailable && !isMachineLocator(root)) return undefined;
  const projected = resolveWorkspacePath(root, target);
  if (isMachineLocator(projected)) return planMachineTarget(request, projected);
  return { kind: 'host', readPath: projected, hostPath: projected };
}

/**
 * A Machine locator plans like a host path: the same admission pre-evaluation
 * over the canonical locator the read submits, then a probe of the absolute
 * Machine path. A listing form (`machine://`, `machine://<name>`) has nothing
 * to probe, so it reads directly like web; a refusal stays prose. No Machine
 * is reached unless the Run may reach the configured Machines.
 */
function planMachineTarget(
  request: PromptImportRequest,
  locator: string,
): ImportPlan | undefined {
  if (!request.machineAvailable) return undefined;
  const parsed = parseMachineLocator(locator);
  if (parsed.kind === 'list' || parsed.kind === 'roots') {
    return { kind: 'direct', readPath: locator };
  }
  if (parsed.kind !== 'path') return undefined;
  return {
    kind: 'machine',
    name: parsed.name,
    machinePath: parsed.path,
    readPath:
      formatMachineLocator(parsed.name, parsed.path, parsed.selector) ??
      locator,
  };
}

function planFileAlias(
  request: PromptImportRequest,
  target: string,
): ImportPlan | undefined {
  if (!request.hostAvailable) return undefined;
  const alias = decodeFileAlias(target);
  return alias.ok
    ? { kind: 'host', readPath: target, hostPath: alias.hostPath }
    : undefined;
}

/**
 * Sources with a probe or an availability gate plan here. Every other scheme
 * native `read` accepts imports through one direct read, so a scheme `read`
 * gains never stays silent prose; one `read` refuses stays prose.
 */
function planScheme(
  request: PromptImportRequest,
  scheme: string,
  target: string,
): ImportPlan | undefined {
  if (scheme === KNOWLEDGE_LOCATOR_SCHEME) {
    return request.knowledgeAvailable
      ? { kind: 'knowledge', readPath: target }
      : undefined;
  }
  if (scheme === MEDIA_LOCATOR_SCHEME) {
    return { kind: 'media', readPath: target };
  }
  // A probe would cost a connection and admission resolves asynchronously, so
  // `ssh://` reads directly like web: `read` itself admits it (ssh-locator D6a).
  if (scheme === SSH_SCHEME && !request.sshAvailable) return undefined;
  return readAcceptsScheme(scheme)
    ? { kind: 'direct', readPath: target }
    : undefined;
}

async function handleTarget(
  run: ImportRun,
  target: string,
  ordinal: number,
  plan: ImportPlan,
): Promise<void> {
  if (plan.kind === 'direct') {
    return attemptRead(run, { target, ordinal, readPath: plan.readPath });
  }
  // A target behind a probe may be prose, so an expired work bound drops it
  // without a trace.
  if (workExpired(run)) return;
  if (!run.request.admitsRead(plan.readPath)) {
    // The audited denial runs without a probe, so existence never shows.
    await run.request.readImport(plan.readPath, ordinal, target);
    run.outcomes.push({ locator: target, outcome: 'denied' });
    return;
  }
  const resolved = await probePlan(run.request, plan);
  if (resolved === PROMPT_IMPORT_KNOWLEDGE_CANCELLED) {
    run.knowledgeProbeCancelled = true;
    return;
  }
  if (resolved === undefined) return;
  return attemptRead(run, {
    target,
    ordinal,
    readPath: plan.readPath,
    resolved,
  });
}

/**
 * Host paths probe the whole literal first, as `read` does, then the path
 * with its selector split off. A Machine locator is probed once, over the
 * absolute path the locator names (its selector is never a path character).
 * Knowledge and media locators have no literal colon, so only the
 * selector-free locator is probed.
 */
async function probePlan(
  request: PromptImportRequest,
  plan: Exclude<ImportPlan, { kind: 'direct' }>,
): Promise<string | undefined | typeof PROMPT_IMPORT_KNOWLEDGE_CANCELLED> {
  if (plan.kind === 'machine') {
    return request.probeMachine(plan.name, plan.machinePath);
  }
  if (plan.kind === 'media') {
    return request.probeMedia(
      withoutSelector(plan.readPath, `${MEDIA_LOCATOR_SCHEME}://`),
    );
  }
  if (plan.kind === 'knowledge') {
    try {
      return await request.probeKnowledge(
        withoutSelector(plan.readPath, KNOWLEDGE_PREFIX),
      );
    } catch (error) {
      if (!isKnowledgeCancellation(error)) throw error;
      return PROMPT_IMPORT_KNOWLEDGE_CANCELLED;
    }
  }
  if (await request.probeHost(plan.hostPath)) return plan.hostPath;
  const { path, selector } = splitSelectorSuffix(plan.hostPath);
  if (selector === undefined) return undefined;
  return (await request.probeHost(path)) ? path : undefined;
}

/** `path` up to the first colon after its scheme's `prefix`. */
function withoutSelector(path: string, prefix: string): string {
  const colon = path.indexOf(':', prefix.length);
  return colon < 0 ? path : path.slice(0, colon);
}

type ReadAttempt = {
  readonly target: string;
  readonly ordinal: number;
  readonly readPath: string;
  readonly resolved?: string;
};

function outcomeBase(attempt: ReadAttempt) {
  return {
    locator: attempt.target,
    ...(attempt.resolved !== undefined && { resolved: attempt.resolved }),
  };
}

/**
 * A read that did not succeed is denied when the read group refused it, omitted
 * when the Run or the budget cut it off rather than the target, else failed.
 */
function recordUnsuccessfulRead(
  run: ImportRun,
  attempt: ReadAttempt,
  admission: PermissionDecision | undefined,
): void {
  if (admission?.decision === 'reject') {
    run.outcomes.push({ ...outcomeBase(attempt), outcome: 'denied' });
  } else if (run.request.signal.aborted) {
    run.omitted.push(attempt.target);
  } else {
    run.outcomes.push({ ...outcomeBase(attempt), outcome: 'failed' });
  }
}

/**
 * One read of a probe survivor or no-probe target, unless a bound closed. A
 * media result counts as a read; only its serialized envelope counts toward
 * the output bound, never the binary bytes or an image thumbnail.
 */
async function attemptRead(
  run: ImportRun,
  attempt: ReadAttempt,
): Promise<void> {
  if (
    run.outputFull ||
    run.reads >= MAX_PROMPT_IMPORT_READS ||
    workExpired(run)
  ) {
    run.omitted.push(attempt.target);
    return;
  }
  run.reads += 1;
  const read = await run.request.readImport(
    attempt.readPath,
    attempt.ordinal,
    attempt.target,
  );
  const base = outcomeBase(attempt);
  if (read.result.status !== 'success') {
    recordUnsuccessfulRead(run, attempt, read.admission);
    return;
  }
  const size = Buffer.byteLength(read.text, 'utf8');
  if (run.bytes + size > MAX_PROMPT_IMPORT_BYTES) {
    run.outputFull = true;
    run.omitted.push(attempt.target);
    return;
  }
  run.bytes += size;
  const attachment = promptImportMedia(read.result);
  run.outcomes.push({
    ...base,
    outcome: 'imported',
    body: read.text,
    ...(read.result['truncated'] === true && { truncated: true }),
    ...(attachment !== undefined && { attachment }),
  });
}

function workExpired(run: ImportRun): boolean {
  return (
    run.knowledgeProbeCancelled ||
    run.request.signal.aborted ||
    run.request.nowMs() - run.startedAt >= PROMPT_IMPORT_WORK_MS
  );
}

function isKnowledgeCancellation(
  error: unknown,
): error is KnowledgeFilesystemError {
  return (
    error instanceof KnowledgeFilesystemError &&
    error.code === 'knowledge_cancelled'
  );
}
