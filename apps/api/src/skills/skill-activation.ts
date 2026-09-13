/**
 * Pre-request skill activation (system-provided-skills D5).
 *
 * Explicit `$skill` mentions are loaded BEFORE the Run's first model request, so
 * the instructions are already in the context the model reads on its first step
 * rather than arriving as a tool result it must react to.
 *
 * Three bounds apply, and all three are enforced here rather than by the caller:
 * a count of distinct selections, the aggregate serialized output including
 * envelopes, and aggregate wall-clock work. Whichever binds first, the
 * unattempted remainder is reported in ONE bounded item — a per-selection notice
 * would multiply the very cost the bound exists to cap.
 *
 * Loading goes through `runTool` with the bound read declaration, so every
 * selection passes the same identity, schema, and permission admission a
 * model-initiated read passes. There is no parallel evaluator here, and
 * activation can never grant itself authority the read tool lacks.
 */

import { measureNativeModelOutput } from '@workspace/native-file-tools';
import { isRecord, isString } from '@workspace/runtime-safety';

import { type AuthoredContextItemPart } from '../chats/context-item';
import {
  createSkillActivationFailureItem,
  createSkillActivationItem,
  createSkillActivationOmissionItem,
  type SkillActivationFailureReason,
} from '../chats/skill-activation-item';
import { type PermissionDecision } from '../tools/permissions/types';
import { runTool } from '../tools/runner';
import { type Tool, type ToolContext, type ToolResult } from '../tools/types';
import { type SkillMention } from './skill-mention';
import { skillInstructionBody } from './skill-package';

/**
 * Distinct selections one turn attempts. Eight is comfortably more than a
 * person names in one request while staying far below the count at which
 * pre-request loading would dominate the turn's cost.
 */
export const MAX_SKILL_ACTIVATIONS = 8;

/** Aggregate serialized activation output, envelopes included. */
export const MAX_SKILL_ACTIVATION_BYTES = 128 * 1024;

/** Aggregate activation work, further limited by the Run's own deadline. */
export const SKILL_ACTIVATION_BUDGET_MS = 30_000;

export type SkillActivationOutcome = {
  /** Items to persist on the triggering user message, in selection order. */
  readonly items: ReadonlyArray<AuthoredContextItemPart>;
  /**
   * The selections this turn carried, for the Run's skill reads. Every ATTEMPTED
   * selection is included — a failed load still means the user named it, so a
   * model-initiated read of that skill's resources is not refused as unselected.
   */
  readonly selection: ReadonlySet<string>;
};

/**
 * Durable audit for activation reads.
 *
 * Split into `admitted` and `completed` rather than one callback because the
 * ORDER is the guarantee: the admission record must be durable BEFORE the file
 * is opened (an audit failure prevents the read), and the completion record
 * carries what was actually returned. Both are keyed by the caller-supplied
 * call id, which encodes the `(Run, mention ordinal)` identity the recovery path
 * reuses.
 */
export type SkillActivationActivity = {
  readonly admitted: (
    toolCallId: string,
    decision: PermissionDecision,
  ) => void | Promise<void>;
  readonly completed: (
    toolCallId: string,
    result: ToolResult,
  ) => void | Promise<void>;
};

type ActivationRequest = {
  readonly mentions: ReadonlyArray<SkillMention>;
  readonly runId: string;
  readonly readTool: Tool;
  /** Trusted Run context WITHOUT `skillSelection`; this function supplies it. */
  readonly toolContext: ToolContext;
  readonly callTimeoutSeconds: number;
  /** Durable audit for one activation read; see `SkillActivationActivity`. */
  readonly activity: SkillActivationActivity;
  /**
   * Skills a PRIOR attempt of this Run already resolved, successfully or as a
   * recorded failure. Recovery replays those from their stored items instead of
   * re-reading, so a package or policy change between attempts cannot rewrite an
   * observation the model already consumed.
   */
  readonly resolved?: ReadonlySet<string>;
};

/**
 * Load every selected skill, in first-mention order, before the first model
 * request.
 *
 * One selection's failure never stops the others or the Run: each attempt
 * resolves to its own item, and a read that was denied, missing, or unreadable
 * becomes a bounded failure item rather than an exception.
 */
export async function activateSkills(
  input: ActivationRequest,
): Promise<SkillActivationOutcome> {
  const admitted = input.mentions.slice(0, MAX_SKILL_ACTIVATIONS);
  const unattempted = input.mentions
    .slice(MAX_SKILL_ACTIVATIONS)
    .map((mention) => mention.name);
  // Every attempted name joins the set, success or failure alike: the user's
  // mention is what authorizes a later read of that package's resources — and a
  // skill a prior attempt resolved keeps that authorization too.
  const selection = new Set(admitted.map((mention) => mention.name));

  const items: Array<AuthoredContextItemPart> = [];
  const bytes = await attemptWithinBudget(
    input,
    { admitted, selection },
    items,
    unattempted,
  );
  appendOmissionItem(input.runId, unattempted, bytes, items);

  return { items, selection };
}

/** What one selection resolved to, from this turn's budget's point of view. */
type MentionAttempt =
  | {
      readonly kind: 'item';
      readonly item: AuthoredContextItemPart;
      readonly bytes: number;
    }
  | { readonly kind: 'unattempted' };

/**
 * Load as many selections as the output and work budgets allow, in order.
 *
 * The TIME budget is checked before each read, so one is never started that
 * cannot finish. The BYTE budget can only be measured after a read, because an
 * item's size depends on what the package contains — so a selection that
 * overflows it is reported as unattempted even though its read ran, which the
 * omission wording states honestly: it was not loaded into the prompt.
 */
async function attemptWithinBudget(
  input: ActivationRequest,
  selections: {
    readonly admitted: ReadonlyArray<SkillMention>;
    readonly selection: ReadonlySet<string>;
  },
  items: Array<AuthoredContextItemPart>,
  unattempted: Array<string>,
): Promise<number> {
  let bytes = 0;
  const deadline = Date.now() + SKILL_ACTIVATION_BUDGET_MS;

  for (const [ordinal, mention] of selections.admitted.entries()) {
    // Already resolved by a prior attempt of this Run: its stored item is the
    // observation, and re-reading could report something different.
    if (input.resolved?.has(mention.name) === true) continue;
    const attempt = await attemptMention(
      input,
      { selection: selections.selection, ordinal, deadline, bytes },
      mention,
    );
    if (attempt.kind !== 'item') {
      unattempted.push(mention.name);
      continue;
    }
    bytes += attempt.bytes;
    items.push(attempt.item);
  }
  return bytes;
}

async function attemptMention(
  input: ActivationRequest,
  budget: {
    readonly selection: ReadonlySet<string>;
    readonly ordinal: number;
    readonly deadline: number;
    readonly bytes: number;
  },
  mention: SkillMention,
): Promise<MentionAttempt> {
  const remainingMs = budget.deadline - Date.now();
  if (remainingMs <= 0) return { kind: 'unattempted' };
  const item = await attemptActivation(input, {
    mention,
    selection: budget.selection,
    remainingMs,
    ordinal: budget.ordinal,
  });
  const bytes = measureNativeModelOutput(item);
  return budget.bytes + bytes > MAX_SKILL_ACTIVATION_BYTES
    ? { kind: 'unattempted' }
    : { kind: 'item', item, bytes };
}

/**
 * The single bounded item naming every unattempted selection.
 *
 * Its own size is measured rather than assumed: it lists every remainder in both
 * its payload and its text, so leaving it outside the accounting would let the
 * aggregate bound be exceeded by the very item reporting the overflow. If even
 * the notice cannot fit, admitted instructions have already spent the budget,
 * and the remainder stays inspectable at `skill://` instead.
 */
function appendOmissionItem(
  runId: string,
  unattempted: ReadonlyArray<string>,
  bytes: number,
  items: Array<AuthoredContextItemPart>,
): void {
  if (unattempted.length === 0) return;
  const omission = createSkillActivationOmissionItem({
    runId,
    skills: unattempted,
  });
  if (
    bytes + measureNativeModelOutput(omission) <=
    MAX_SKILL_ACTIVATION_BYTES
  ) {
    items.push(omission);
  }
}

/**
 * One selection: run the bound read for its raw `SKILL.md` and turn the result
 * into exactly one item.
 *
 * `skill://<name>:raw` rather than the default root read, because the body is
 * published verbatim — line-number prefixes belong to navigation, not to
 * instructions the model is told to follow.
 */
async function attemptActivation(
  input: ActivationRequest,
  one: {
    readonly mention: SkillMention;
    readonly selection: ReadonlySet<string>;
    readonly remainingMs: number;
    readonly ordinal: number;
  },
): Promise<AuthoredContextItemPart> {
  const { mention, selection, remainingMs, ordinal } = one;
  // The durable identity of this activation is `(Run, mention ordinal)`, so a
  // recovery of the same Run addresses the same read.
  const toolCallId = `skill-activation-${input.runId}-${ordinal}`;
  const result = await runTool(
    input.readTool,
    { path: `skill://${mention.name}:raw` },
    { ...readContext(input.toolContext, selection, remainingMs), toolCallId },
    input.callTimeoutSeconds,
    (decision) => input.activity.admitted(toolCallId, decision),
  );
  await input.activity.completed(toolCallId, result);
  return activationItem(input.runId, mention.name, result);
}

/**
 * The trusted context for one activation read: the Run's own context, plus the
 * turn's selection set and a deadline clamped to what remains of the activation
 * budget.
 *
 * The clamp is an ABORT SIGNAL, not `timeoutMs`. `runTool` derives its own
 * timeout from `tool.timeoutSeconds ?? callTimeoutSeconds` and OVERWRITES
 * `context.timeoutMs`, so a field-level clamp would be dead code and one slow
 * read could delay the turn's first model request by the full per-call timeout.
 * Composing the remaining budget into the signal is what actually bounds the
 * read: the runner composes that with its own timeout, and whichever expires
 * first aborts.
 */
function readContext(
  toolContext: ToolContext,
  selection: ReadonlySet<string>,
  remainingMs: number,
): ToolContext {
  const budgetSignal = AbortSignal.timeout(remainingMs);
  return {
    ...toolContext,
    skillSelection: selection,
    abortSignal: toolContext.abortSignal
      ? AbortSignal.any([toolContext.abortSignal, budgetSignal])
      : budgetSignal,
  };
}

/** One read result as exactly one item: the instructions, or a closed failure. */
function activationItem(
  runId: string,
  skill: string,
  result: ToolResult,
): AuthoredContextItemPart {
  if (result.status !== 'success') {
    return failureItem(runId, skill, failureReason(result));
  }
  const read = readSkillReadOutput(result);
  if (read === undefined) return failureItem(runId, skill, 'read_failed');
  return createSkillActivationItem({
    runId,
    skill,
    skillDirectory: read.skillDirectory,
    instructionsPath: read.resolvedPath,
    // A body the runner truncated must SAY so: silently presenting a partial
    // instruction body as the whole skill would have the model follow half a
    // procedure. Truncation inside the frontmatter is the same problem, since
    // the block may then be unterminated and its removal incomplete.
    instructions: skillInstructionBody(read.content),
    ...(read.truncationNotice !== undefined && {
      truncationNotice: read.truncationNotice,
    }),
  });
}

function failureItem(
  runId: string,
  skill: string,
  reason: SkillActivationFailureReason,
): AuthoredContextItemPart {
  return createSkillActivationFailureItem({ runId, skill, reason });
}

/**
 * The closed reason a failed read maps to. Closed on purpose: a read failure can
 * carry an operator path or a host error, and neither belongs in model text — the
 * reason code is the whole disclosure.
 */
function failureReason(result: ToolResult): SkillActivationFailureReason {
  if (result.status !== 'error') return 'read_failed';
  switch (result.type) {
    case 'not_found':
      return 'not_found';
    case 'skill_unavailable':
    case 'skill_catalog_unavailable':
      return 'unavailable';
    case 'permission_denied':
      return 'permission_denied';
    default:
      return 'read_failed';
  }
}

/**
 * The envelope fields a successful skill read publishes. Absent or malformed
 * envelope data is a read failure, not a partial activation: an instruction body
 * without the paths it must be resolved against is not usable.
 */
function readSkillReadOutput(result: ToolResult):
  | {
      readonly skillDirectory: string;
      readonly resolvedPath: string;
      readonly content: string;
      readonly truncationNotice?: string;
    }
  | undefined {
  if (!isRecord(result)) return undefined;
  const skillDirectory: unknown = result['skillDirectory'];
  const resolvedPath: unknown = result['resolvedPath'];
  const content: unknown = result['content'];
  const truncationNotice: unknown = result['truncationNotice'];
  if (
    !isString(skillDirectory) ||
    !isString(resolvedPath) ||
    !isString(content)
  ) {
    return undefined;
  }
  return {
    skillDirectory,
    resolvedPath,
    content,
    ...(isString(truncationNotice) && { truncationNotice }),
  };
}
