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
  MAX_OMISSION_IMPORT_LOCATOR_LENGTH,
  MAX_OMISSION_IMPORT_NAMES,
  MAX_OMISSION_NAMES,
  type SkillActivationFailureReason,
} from '../chats/skill-activation-item';
import { type Tool, type ToolContext, type ToolResult } from '../tools/types';
import { type SkillMention } from './skill-mention';
import {
  expandSkillImports,
  readSkillActivationFile,
  type SkillActivationActivity,
  type SkillImport,
} from './skill-imports';
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
  const unattemptedImports: Array<string> = [];
  await attemptWithinBudget(
    input,
    { admitted, selection, ceiling: instructionCeiling(input) },
    items,
    { skills: unattempted, imports: unattemptedImports },
  );
  appendOmissionItem(input.runId, unattempted, unattemptedImports, items);
  return { items, selection };
}

/**
 * The bytes instructions may spend, which is the aggregate bound less the
 * largest omission notice this turn could need.
 *
 * Accounting for what did not load is not optional - every unattempted
 * selection is reported - so the notice cannot be the thing that overflows.
 * Its worst case is bounded by `MAX_OMISSION_NAMES` and the longest name a
 * mention can carry, never by how many names the message contains: nothing
 * caps distinct mentions, so reserving one line per mention would let a
 * message of a few tens of KB drive this ceiling negative and stop everything
 * from loading.
 */
function instructionCeiling(input: ActivationRequest): number {
  if (input.mentions.length === 0) return MAX_SKILL_ACTIVATION_BYTES;
  const reserved = input.mentions
    .map((mention) => mention.name)
    .sort((left, right) => right.length - left.length)
    .slice(0, MAX_OMISSION_NAMES);
  const worstCase = createSkillActivationOmissionItem({
    runId: input.runId,
    // One more than the bound, so the reserve also covers the sentence that
    // reports the remainder as a count.
    skills: [
      ...reserved,
      ...(input.mentions.length > reserved.length ? ['x'] : []),
    ],
    // Imports are discovered only after an activation succeeds. The notice
    // lists at most MAX_OMISSION_IMPORT_NAMES locators of at most
    // MAX_OMISSION_IMPORT_LOCATOR_LENGTH characters each, however long the
    // real locators are, so this reserve is a few KB. The extra entry and the
    // over-long locators make the producer exercise both its remainder
    // sentence and its truncation ellipsis.
    imports: Array.from({ length: MAX_OMISSION_IMPORT_NAMES + 1 }, () =>
      'x'.repeat(MAX_OMISSION_IMPORT_LOCATOR_LENGTH + 1),
    ),
  });
  return MAX_SKILL_ACTIVATION_BYTES - measureNativeModelOutput(worstCase);
}

type ActivationAttempt = {
  readonly item: AuthoredContextItemPart;
  readonly omittedImports: ReadonlyArray<string>;
};
type ActivationBudget = {
  readonly selection: ReadonlySet<string>;
  readonly ordinal: number;
  readonly deadline: number;
  readonly bytes: number;
  readonly ceiling: number;
};
type ActivationRead = ActivationBudget & {
  readonly mention: SkillMention;
  readonly remainingMs: number;
};
type ActivationExpansion = {
  readonly mention: SkillMention;
  readonly read: SkillReadOutput;
  readonly instructions: string;
};

/** What one selection resolved to, from this turn's budget's point of view. */
type MentionAttempt =
  | {
      readonly kind: 'item';
      readonly item: AuthoredContextItemPart;
      readonly bytes: number;
      readonly omittedImports: ReadonlyArray<string>;
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
    readonly ceiling: number;
  },
  items: Array<AuthoredContextItemPart>,
  omitted: { readonly skills: Array<string>; readonly imports: Array<string> },
): Promise<void> {
  let bytes = 0;
  const deadline = Date.now() + SKILL_ACTIVATION_BUDGET_MS;

  for (const [ordinal, mention] of selections.admitted.entries()) {
    // Already resolved by a prior attempt of this Run: its stored item is the
    // observation, and re-reading could report something different.
    if (input.resolved?.has(mention.name) === true) continue;
    const attempt = await attemptMention(
      input,
      {
        selection: selections.selection,
        ordinal,
        deadline,
        bytes,
        ceiling: selections.ceiling,
      },
      mention,
    );
    if (attempt.kind !== 'item') {
      omitted.skills.push(mention.name);
      continue;
    }
    bytes += attempt.bytes;
    omitted.imports.push(...attempt.omittedImports);
    items.push(attempt.item);
  }
}

async function attemptMention(
  input: ActivationRequest,
  budget: ActivationBudget,
  mention: SkillMention,
): Promise<MentionAttempt> {
  const remainingMs = budget.deadline - Date.now();
  if (remainingMs <= 0) return { kind: 'unattempted' };
  const activation = await attemptActivation(input, {
    mention,
    selection: budget.selection,
    remainingMs,
    deadline: budget.deadline,
    ordinal: budget.ordinal,
    bytes: budget.bytes,
    ceiling: budget.ceiling,
  });
  const bytes = measureNativeModelOutput(activation.item);
  return budget.bytes + bytes > budget.ceiling
    ? { kind: 'unattempted' }
    : {
        kind: 'item',
        item: activation.item,
        bytes,
        omittedImports: activation.omittedImports,
      };
}

/**
 * The single bounded item naming every unattempted selection and import.
 *
 * Always emitted when anything went unattempted: the instruction ceiling
 * already reserved this notice's worst case, so the item reporting the
 * overflow cannot itself be what overflows.
 */
function appendOmissionItem(
  runId: string,
  unattempted: ReadonlyArray<string>,
  unattemptedImports: ReadonlyArray<string>,
  items: Array<AuthoredContextItemPart>,
): void {
  if (unattempted.length === 0 && unattemptedImports.length === 0) return;
  items.push(
    createSkillActivationOmissionItem({
      runId,
      skills: unattempted,
      ...(unattemptedImports.length > 0 && { imports: unattemptedImports }),
    }),
  );
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
  one: ActivationRead,
): Promise<ActivationAttempt> {
  const { mention } = one;
  const result = await readActivation(input, one);
  const read = readSkillReadOutput(result);
  if (read === undefined) {
    return {
      item: failureItem(input.runId, mention.name, failureReason(result)),
      omittedImports: [],
    };
  }
  const instructions = skillInstructionBody(read.content);
  return expandActivationImports(input, one, {
    mention,
    read,
    instructions,
  });
}

async function expandActivationImports(
  input: ActivationRequest,
  one: ActivationRead,
  activation: ActivationExpansion,
): Promise<ActivationAttempt> {
  const createItem = (imports: ReadonlyArray<SkillImport>) =>
    createActivationFromRead(
      { runId: input.runId, skill: activation.mention.name },
      activation.read,
      activation.instructions,
      imports,
    );
  const expansion = await expandSkillImports({
    skill: activation.mention.name,
    runId: input.runId,
    mentionOrdinal: one.ordinal,
    body: activation.instructions,
    selection: one.selection,
    toolContext: input.toolContext,
    readTool: input.readTool,
    callTimeoutSeconds: input.callTimeoutSeconds,
    deadline: one.deadline,
    activity: input.activity,
    canAccept: (imports) =>
      one.bytes + measureNativeModelOutput(createItem(imports)) <= one.ceiling,
  });
  return {
    item: createItem(expansion.imports),
    omittedImports: expansion.omitted,
  };
}

async function readActivation(
  input: ActivationRequest,
  activation: ActivationRead,
): Promise<ToolResult> {
  const toolCallId = `skill-activation-${input.runId}-${activation.ordinal}`;
  return readSkillActivationFile({
    readTool: input.readTool,
    toolContext: input.toolContext,
    selection: activation.selection,
    remainingMs: activation.remainingMs,
    callTimeoutSeconds: input.callTimeoutSeconds,
    toolCallId,
    readInput: { path: `skill://${activation.mention.name}:raw` },
    activity: input.activity,
  });
}

function createActivationFromRead(
  identity: { readonly runId: string; readonly skill: string },
  read: SkillReadOutput,
  instructions: string,
  imports: ReadonlyArray<SkillImport>,
): AuthoredContextItemPart {
  return createSkillActivationItem({
    runId: identity.runId,
    skill: identity.skill,
    skillDirectory: read.skillDirectory,
    instructionsPath: read.resolvedPath,
    instructions,
    ...(read.truncationNotice !== undefined && {
      truncationNotice: read.truncationNotice,
    }),
    ...(imports.length > 0 && { imports }),
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
 * envelope data is a read failure, not a partial activation: an instruction
 * body without the paths it must be resolved against is not usable.
 */
type SkillReadOutput = {
  readonly skillDirectory: string;
  readonly resolvedPath: string;
  readonly content: string;
  readonly truncationNotice?: string;
};

function readSkillReadOutput(result: ToolResult): SkillReadOutput | undefined {
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
