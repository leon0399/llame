/**
 * The `skill-activation` producer (system-provided-skills D5).
 *
 * One item per explicitly selected skill, plus one bounded failure variant per
 * failed selection and one omission item covering every unattempted selection.
 *
 * Producer discipline follows the rail's: this module owns its payload
 * (semantics only — the selected name, the published paths, a closed failure
 * reason, the observed content identity) and the body text. The envelope, its
 * provenance line, attribute escaping, and author-time order belong to
 * `context-item.ts`.
 *
 * Operator-authored instruction content is neutralized with
 * `sanitizeAuthoredText` before it is composed here, so a skill body cannot
 * close the `skill_instructions` element it sits in or forge another envelope.
 */

import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { loadPackagedTemplate } from '../prompts/template-engine';
import {
  isNumber,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import {
  escapeXmlAttribute,
  type AuthoredContextItemPart,
} from './context-item';
import {
  createRenderedContextItem,
  isExactRecord,
  isNonEmptyString,
} from './context-item-shared';

/** Closed reasons a selection can fail. Never carries operator diagnostics. */
export const SKILL_ACTIVATION_FAILURE_REASONS = [
  'not_found',
  'unavailable',
  'permission_denied',
  'read_failed',
] as const;

export type SkillActivationFailureReason =
  (typeof SKILL_ACTIVATION_FAILURE_REASONS)[number];

const FAILURE_LABELS: Readonly<Record<SkillActivationFailureReason, string>> = {
  not_found: 'no such skill is installed',
  unavailable: 'the skill is installed but not currently usable',
  permission_denied: 'permission denied',
  read_failed: 'the instructions could not be read',
};

export interface SkillActivationPayload extends UnknownRecord {
  readonly kind: 'activation';
  readonly skill: string;
  readonly skillDirectory: string;
  readonly instructionsPath: string;
  readonly imports?: ReadonlyArray<string>;
}

export interface SkillActivationFailurePayload extends UnknownRecord {
  readonly kind: 'failure';
  readonly skill: string;
  readonly reason: SkillActivationFailureReason;
}

export interface SkillActivationOmissionPayload extends UnknownRecord {
  readonly kind: 'omission';
  readonly skills: ReadonlyArray<string>;
  readonly imports?: ReadonlyArray<string>;
  /** Names past the list bound, reported as a count rather than listed. */
  readonly beyond?: number;
}

type SkillActivationItemPayload =
  | SkillActivationPayload
  | SkillActivationFailurePayload
  | SkillActivationOmissionPayload;

export function isSkillActivationPayload(
  value: unknown,
): value is SkillActivationItemPayload {
  if (!isRecordWithKind(value)) return false;
  switch (value['kind']) {
    case 'activation': {
      const hasImports = Object.hasOwn(value, 'imports');
      return (
        isExactRecord(value, [
          'kind',
          'skill',
          'skillDirectory',
          'instructionsPath',
          ...(hasImports ? ['imports'] : []),
        ]) &&
        isNonEmptyString(value['skill']) &&
        isNonEmptyString(value['skillDirectory']) &&
        isNonEmptyString(value['instructionsPath']) &&
        (!hasImports ||
          (Array.isArray(value['imports']) &&
            value['imports'].length > 0 &&
            value['imports'].every(isNonEmptyString)))
      );
    }
    case 'failure':
      return (
        isExactRecord(value, ['kind', 'skill', 'reason']) &&
        isNonEmptyString(value['skill']) &&
        isFailureReason(value['reason'])
      );
    case 'omission':
      return isOmissionPayload(value);
    default:
      return false;
  }
}

function isOmissionPayload(value: UnknownRecord): boolean {
  const hasImports = Object.hasOwn(value, 'imports');
  const hasBeyond = Object.hasOwn(value, 'beyond');
  const skills = value['skills'];
  const imports = value['imports'];
  const hasSkills = Array.isArray(skills) && skills.length > 0;
  const hasNonEmptyImports =
    hasImports && Array.isArray(imports) && imports.length > 0;
  return (
    isExactRecord(value, [
      'kind',
      'skills',
      ...(hasImports ? ['imports'] : []),
      ...(hasBeyond ? ['beyond'] : []),
    ]) &&
    Array.isArray(skills) &&
    skills.every(isNonEmptyString) &&
    (!hasImports ||
      (Array.isArray(imports) &&
        imports.length > 0 &&
        imports.every(isNonEmptyString))) &&
    (hasSkills || hasNonEmptyImports) &&
    // Present only when names were left out, and then it counts at least one:
    // a zero would claim a remainder that does not exist.
    (!hasBeyond ||
      (isNumber(value['beyond']) &&
        Number.isInteger(value['beyond']) &&
        value['beyond'] > 0))
  );
}

function isRecordWithKind(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

function isFailureReason(
  value: unknown,
): value is SkillActivationFailureReason {
  return (
    isString(value) &&
    SKILL_ACTIVATION_FAILURE_REASONS.some((reason) => reason === value)
  );
}

/**
 * One successful activation: which mention selected the skill, the published
 * paths, the path guidance, the precedence line, and the current instructions
 * with frontmatter removed.
 */
export function createSkillActivationItem(input: {
  readonly runId: string;
  readonly skill: string;
  readonly skillDirectory: string;
  readonly instructionsPath: string;
  readonly instructions: string;
  /**
   * The reader's own truncation indicator, when it shortened the body. Carried
   * into the model-visible text so a partial instruction body is never presented
   * as the complete skill.
   */
  readonly truncationNotice?: string;
  readonly imports?: ReadonlyArray<{
    readonly path: string;
    readonly body: string;
    readonly truncationNotice?: string;
  }>;
}): AuthoredContextItemPart {
  const imports = input.imports ?? [];
  const importPaths = imports.map((file) => file.path);
  const payload: SkillActivationPayload = {
    kind: 'activation',
    skill: input.skill,
    skillDirectory: input.skillDirectory,
    instructionsPath: input.instructionsPath,
    ...(importPaths.length > 0 && { imports: importPaths }),
  };
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the declared type cannot express the invariants this guard enforces, so it is an assertion about the value, not a redundant re-parse of a type we already trust.
  if (!isSkillActivationPayload(payload)) {
    throw new TypeError('Invalid server-authored skill activation metadata');
  }
  return createRenderedContextItem({
    producer: 'skill-activation',
    form: 'notice',
    runId: input.runId,
    payload,
    body: renderActivation(
      payload,
      input.instructions,
      input.truncationNotice,
      imports,
    ),
  });
}

/**
 * The failure body. The closed reason code is resolved to its human label in
 * the producer; the label map stays in TypeScript and the code itself never
 * reaches the body.
 */
const renderActivationFailureTemplate = loadPackagedTemplate<{
  readonly skill: string;
  readonly label: string;
}>(__dirname, 'skill-activation-failure');

/**
 * One bounded failure for a selection that did not load. Names the mention and
 * one closed reason — never operator diagnostics, a host error, or a resolved
 * path — and tells the model not to invent the instructions.
 */
export function createSkillActivationFailureItem(input: {
  readonly runId: string;
  readonly skill: string;
  readonly reason: SkillActivationFailureReason;
}): AuthoredContextItemPart {
  const payload: SkillActivationFailurePayload = {
    kind: 'failure',
    skill: input.skill,
    reason: input.reason,
  };
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the declared type cannot express the invariants this guard enforces, so it is an assertion about the value, not a redundant re-parse of a type we already trust.
  if (!isSkillActivationPayload(payload)) {
    throw new TypeError('Invalid server-authored skill activation metadata');
  }
  return createRenderedContextItem({
    producer: 'skill-activation',
    form: 'notice',
    runId: input.runId,
    payload,
    body: renderActivationFailureTemplate({
      skill: payload.skill,
      label: FAILURE_LABELS[payload.reason],
    }),
  });
}

/** How many names one notice lists before it reports the rest as a count. */
export const MAX_OMISSION_NAMES = 32;

/**
 * The omission body. The noun, the bounded name list, and the remainder
 * clause are all derived in the producer; the template only joins them.
 */
const renderActivationOmissionTemplate = loadPackagedTemplate<{
  readonly hasSkills: boolean;
  readonly noun: string;
  readonly listed: string;
  readonly rest: string;
  readonly hasImports: boolean;
  readonly imports: string;
  readonly importsRest: string;
}>(__dirname, 'skill-activation-omission');

/**
 * ONE item covering every selection the count, output, or time budget left
 * unattempted. A per-selection item would multiply the very cost the bound
 * exists to cap, and the unattempted names are all one fact: the remainder.
 *
 * The list itself is bounded. Nothing caps how many distinct names a message
 * can mention, so listing all of them would let the item reporting the
 * overflow be the thing that overflows: past `MAX_OMISSION_NAMES` the rest is
 * reported as a count, which keeps the notice a fixed size.
 */
type SkillActivationOmissionInput = {
  readonly runId: string;
  readonly skills: ReadonlyArray<string>;
  readonly imports?: ReadonlyArray<string>;
  /**
   * Names an earlier notice already reported as a count rather than listing.
   * A rebuild carries it forward: those selections are still unattempted, and
   * rebuilding from the truncated list alone would silently drop them.
   */
  readonly unlisted?: number;
};

type ActivationOmissionTemplateValues = {
  readonly hasSkills: boolean;
  readonly noun: string;
  readonly listed: string;
  readonly rest: string;
  readonly hasImports: boolean;
  readonly imports: string;
  readonly importsRest: string;
};

type BuiltOmission = {
  readonly payload: SkillActivationOmissionPayload;
  readonly template: ActivationOmissionTemplateValues;
};

function buildOmission(input: SkillActivationOmissionInput): BuiltOmission {
  const imports = input.imports ?? [];
  const listedNames = input.skills.slice(0, MAX_OMISSION_NAMES);
  const listedImports = imports.slice(0, MAX_OMISSION_NAMES);
  const unlistedSkills =
    input.skills.length - listedNames.length + (input.unlisted ?? 0);
  const unlistedImports = imports.length - listedImports.length;
  const beyond = unlistedSkills + unlistedImports;
  const listed = listedNames.map((skill) => `\`$${skill}\``).join(', ');
  const listedImportNames = listedImports
    .map((path) => `\`${path}\``)
    .join(', ');
  return {
    payload: {
      kind: 'omission',
      skills: listedNames,
      ...(listedImports.length > 0 && { imports: listedImports }),
      ...(beyond > 0 && { beyond }),
    },
    template: {
      hasSkills: listedNames.length > 0,
      noun: input.skills.length === 1 ? 'skill' : 'skills',
      listed,
      rest:
        unlistedSkills > 0 ? ` and ${unlistedSkills} more not listed here` : '',
      hasImports: listedImports.length > 0,
      imports: listedImportNames,
      importsRest:
        unlistedImports > 0
          ? ` and ${unlistedImports} more not listed here`
          : '',
    },
  };
}

export function createSkillActivationOmissionItem(
  input: SkillActivationOmissionInput,
): AuthoredContextItemPart {
  const { payload, template } = buildOmission(input);
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the declared type cannot express the non-empty invariant this guard enforces, so it is an assertion about the value, not a redundant re-parse of a type we already trust.
  if (!isSkillActivationPayload(payload)) {
    throw new TypeError('Invalid server-authored skill activation metadata');
  }
  return createRenderedContextItem({
    producer: 'skill-activation',
    form: 'notice',
    runId: input.runId,
    payload,
    body: renderActivationOmissionTemplate(template),
  });
}

/**
 * The activation body, carrying the path guidance and precedence line as
 * literal template text plus the current instructions element.
 */
type SkillActivationImport = {
  readonly path: string;
  readonly body: string;
  readonly truncationNotice?: string;
};

const renderActivationTemplate = loadPackagedTemplate<{
  readonly skill: string;
  readonly skillDirectory: string;
  readonly instructionsPath: string;
  readonly hasTruncation: boolean;
  readonly truncationNotice: string | undefined;
  readonly instructions: string;
  readonly imports: ReadonlyArray<{
    readonly path: string;
    readonly hasTruncation: boolean;
    readonly truncationNotice: string | undefined;
    readonly body: string;
  }>;
}>(__dirname, 'skill-activation');

/**
 * Imported content sits inside a `<file>` element, so use the same
 * authored-text neutralization as instruction-file bodies and also neutralize
 * file-shaped tags that could forge or close that element.
 */
function neutralizeImportBody(body: string): string {
  return sanitizeAuthoredText(body).replaceAll(
    /<(\s*\/?\s*file)(?=\s*\/?>|[\s/]+[\w-]+\s*=|$)/giu,
    '&lt;$1',
  );
}

function renderActivation(
  payload: SkillActivationPayload,
  instructions: string,
  truncationNotice: string | undefined,
  imports: ReadonlyArray<SkillActivationImport>,
): string {
  return renderActivationTemplate({
    skill: payload.skill,
    skillDirectory: payload.skillDirectory,
    instructionsPath: payload.instructionsPath,
    hasTruncation: truncationNotice !== undefined,
    truncationNotice,
    // Operator-authored, and it sits inside an element of its own: the sanitizer
    // is what keeps the body from closing that element or opening another
    // envelope. Applied here rather than by the caller so every path into this
    // producer is covered.
    instructions: sanitizeAuthoredText(instructions),
    imports: imports.map((file) => ({
      path: escapeXmlAttribute(file.path),
      hasTruncation: file.truncationNotice !== undefined,
      truncationNotice: file.truncationNotice,
      body: neutralizeImportBody(file.body),
    })),
  });
}
