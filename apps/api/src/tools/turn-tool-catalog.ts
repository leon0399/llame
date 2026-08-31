import { Logger } from '@nestjs/common';

import {
  canonicalJson,
  canonicalize,
  compareCodePoints,
  hashWithDomain,
} from '../canonical-json';
import { type ModelToolDeclaration } from '../db/schema';
import { isRecord, isString, type UnknownRecord } from '../unknown-record';
import { admitToolInputSchema } from './schema-utils';
import {
  asciiCaseFoldToolId,
  isToolId,
  matchesAllowedToolId,
  matchesCodeOwnedToolId,
} from './tool-id';
import { type Tool, type ToolClassification } from './types';

const logger = new Logger('TurnToolCatalog');

export const TOOL_UNAVAILABLE_REASONS = [
  'source_connecting',
  'source_disconnected',
  'protocol_unsupported',
  'discovery_failed',
  'tool_missing',
  'declaration_refused',
  'name_collision',
  // Legacy decode-only reason. Current Knowledge candidates never emit it.
  'knowledge_space_not_configured',
  'knowledge_space_unavailable',
] as const;

export type ToolUnavailableReason = (typeof TOOL_UNAVAILABLE_REASONS)[number];

export const TOOL_UNAVAILABLE_REASON_LABELS = {
  source_connecting: 'server connecting',
  source_disconnected: 'server disconnected',
  protocol_unsupported: 'protocol unsupported',
  discovery_failed: 'tool discovery failed',
  tool_missing: 'tool missing',
  declaration_refused: 'tool declaration refused',
  name_collision: 'tool name collision',
  knowledge_space_not_configured: 'Knowledge Space not configured',
  knowledge_space_unavailable: 'Knowledge Space unavailable',
} satisfies Readonly<Record<ToolUnavailableReason, string>>;

export type TurnToolSource =
  | { readonly type: 'code_owned' }
  | { readonly type: 'mcp'; readonly serverId: string };

export type TurnToolCandidate =
  | {
      readonly source: TurnToolSource;
      readonly state: 'available';
      readonly tool: Tool;
    }
  | {
      readonly source: TurnToolSource;
      readonly state: 'unavailable';
      readonly id: string;
      readonly classification: ToolClassification;
      readonly reason: ToolUnavailableReason;
    };

export type ToolAvailabilityEntry =
  | {
      readonly id: string;
      readonly state: 'available';
      readonly declarationHash: string;
    }
  | {
      readonly id: string;
      readonly state: 'unavailable';
      readonly reason: ToolUnavailableReason;
    };

export type ToolAvailabilityManifestV1 = {
  readonly version: 1;
  readonly entries: ReadonlyArray<ToolAvailabilityEntry>;
};

export type ToolAvailabilityManifestV0 = {
  readonly version: 0;
  readonly state: 'unobserved';
};

export type ToolAvailabilityManifest =
  | ToolAvailabilityManifestV0
  | ToolAvailabilityManifestV1;

export const TOOL_AVAILABILITY_UNOBSERVED: ToolAvailabilityManifestV0 = {
  version: 0,
  state: 'unobserved',
};

export type AdmittedTurnTool = {
  readonly source: TurnToolSource;
  readonly declaration: ModelToolDeclaration;
  readonly declarationHash: string;
  readonly executor: Tool;
};

export type TurnToolCatalog = {
  readonly admitted: ReadonlyArray<AdmittedTurnTool>;
  readonly manifest: ToolAvailabilityManifestV1;
};

export function hasValidTrustedTimeout(
  timeoutSeconds: number | undefined,
  callTimeoutSeconds: number,
): boolean {
  if (!isRepresentableAbortTimeout(callTimeoutSeconds)) {
    return false;
  }
  return (
    timeoutSeconds === undefined ||
    (isRepresentableAbortTimeout(timeoutSeconds) &&
      timeoutSeconds <= callTimeoutSeconds)
  );
}

const MAX_ABORT_TIMEOUT_MS = 2_147_483_647;

function isRepresentableAbortTimeout(timeoutSeconds: number): boolean {
  const timeoutMilliseconds = timeoutSeconds * 1000;
  return (
    Number.isInteger(timeoutMilliseconds) &&
    timeoutMilliseconds >= 1 &&
    timeoutMilliseconds <= MAX_ABORT_TIMEOUT_MS
  );
}

const hasExactKeys = (
  value: UnknownRecord,
  expected: ReadonlyArray<string>,
): boolean => {
  const actual = Object.keys(value).sort(compareCodePoints);
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

const invalidManifest = (detail: string): Error =>
  new Error(`Invalid tool availability manifest: ${detail}.`);

/** `canonicalize`'s JSON round-trip erases compile-time type information;
 * this reasserts it from the actual shape. */
function assertModelToolDeclaration(
  value: unknown,
): asserts value is ModelToolDeclaration {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.description !== 'string' ||
    !isRecord(value.inputSchema)
  ) {
    throw new TypeError('Expected a canonical ModelToolDeclaration');
  }
}

const isToolUnavailableReason = (
  value: unknown,
): value is ToolUnavailableReason =>
  typeof value === 'string' &&
  // SAFETY: value is a plain string, just narrowed above; the reasons tuple's
  // own .includes() only accepts its literal union, so this widens the array
  // to check membership of a general string.
  (TOOL_UNAVAILABLE_REASONS as ReadonlyArray<string>).includes(value);

export function parseToolAvailabilityManifest(
  value: unknown,
): ToolAvailabilityManifest {
  if (!isRecord(value)) {
    throw new Error('Invalid tool availability manifest: expected an object.');
  }
  const manifest: UnknownRecord = value;
  if (manifest['version'] === 0) {
    if (
      !hasExactKeys(manifest, ['state', 'version']) ||
      manifest['state'] !== 'unobserved'
    ) {
      throw invalidManifest('version 0 must be the exact unobserved sentinel');
    }
    return TOOL_AVAILABILITY_UNOBSERVED;
  }
  if (
    manifest['version'] !== 1 ||
    !hasExactKeys(manifest, ['entries', 'version'])
  ) {
    throw invalidManifest('expected exact version 0 or version 1 shape');
  }
  const rawEntries = manifest['entries'];
  if (!Array.isArray(rawEntries)) {
    throw new Error(
      'Invalid tool availability manifest: version 1 entries must be an array.',
    );
  }
  // SAFETY: Array.isArray narrows an unknown value to any[]; asserting
  // unknown[] forces each entry to be validated below rather than silently
  // inheriting any.
  const rawEntryValues = rawEntries as Array<unknown>;

  const entries: Array<ToolAvailabilityEntry> = [];
  let previousId: string | undefined;
  for (const rawEntry of rawEntryValues) {
    const entry = parseToolAvailabilityEntry(rawEntry, previousId);
    entries.push(entry);
    previousId = entry.id;
  }

  return { version: 1, entries };
}

function parseToolAvailabilityEntry(
  rawEntry: unknown,
  previousId: string | undefined,
): ToolAvailabilityEntry {
  if (!isRecord(rawEntry)) {
    throw invalidManifest('entry must contain a string id');
  }
  const rawId = rawEntry['id'];
  if (!isToolId(rawId)) {
    throw invalidManifest('entry must contain a string id');
  }
  const id = rawId;
  if (previousId !== undefined && compareCodePoints(previousId, id) >= 0) {
    throw invalidManifest('entry ids must be non-empty, unique, and sorted');
  }

  const state = rawEntry['state'];
  const declarationHash = rawEntry['declarationHash'];
  if (
    state === 'available' &&
    hasExactKeys(rawEntry, ['declarationHash', 'id', 'state']) &&
    isString(declarationHash) &&
    /^[0-9a-f]{64}$/.test(declarationHash)
  ) {
    return { id, state: 'available', declarationHash };
  }
  const reason = rawEntry['reason'];
  if (
    state === 'unavailable' &&
    hasExactKeys(rawEntry, ['id', 'reason', 'state']) &&
    isToolUnavailableReason(reason)
  ) {
    return { id, state: 'unavailable', reason };
  }
  throw invalidManifest('entry has an invalid state payload');
}

export function hashToolAvailabilityManifest(
  manifest: ToolAvailabilityManifest,
): string {
  return hashWithDomain(
    'llame:model-context:tool-availability:v1',
    canonicalJson(manifest),
  );
}

/** Stable database default for snapshots written before availability is observed. */
export const TOOL_AVAILABILITY_UNOBSERVED_HASH = hashToolAvailabilityManifest(
  TOOL_AVAILABILITY_UNOBSERVED,
);

export function hashToolDeclaration(declaration: ModelToolDeclaration): string {
  return hashWithDomain(
    'llame:tool-declaration:v1',
    canonicalJson(declaration),
  );
}

const candidateId = (candidate: TurnToolCandidate): string =>
  candidate.state === 'available' ? candidate.tool.id : candidate.id;

const candidateClassification = (
  candidate: TurnToolCandidate,
): ToolClassification =>
  candidate.state === 'available'
    ? candidate.tool.classification
    : candidate.classification;

function candidateIsAllowlisted(
  candidate: TurnToolCandidate,
  id: string,
  allowedRules: ReadonlyArray<string>,
): boolean {
  return candidate.source.type === 'code_owned'
    ? matchesCodeOwnedToolId(id, allowedRules)
    : matchesAllowedToolId(id, allowedRules);
}

function collidingToolEntries(
  group: ReadonlyArray<TurnToolCandidate>,
): Array<ToolAvailabilityEntry> {
  const collidingIds = [...new Set(group.map(candidateId))].sort(
    compareCodePoints,
  );
  return collidingIds.map((id) => ({
    id,
    state: 'unavailable' as const,
    reason: 'name_collision' as const,
  }));
}

function unavailableEntry(id: string, reason: ToolUnavailableReason) {
  return { entry: { id, state: 'unavailable' as const, reason } };
}

/** Validates and, if it passes, admits the sole surviving candidate for one
 * folded tool id. Never called on a colliding group (see `collidingToolEntries`). */
async function admitTurnToolCandidate(
  candidate: TurnToolCandidate,
  callTimeoutSeconds: number,
): Promise<{ admitted?: AdmittedTurnTool; entry: ToolAvailabilityEntry }> {
  const id = candidateId(candidate);
  if (candidate.state === 'unavailable') {
    return unavailableEntry(id, candidate.reason);
  }
  if (
    !hasValidTrustedTimeout(candidate.tool.timeoutSeconds, callTimeoutSeconds)
  ) {
    return unavailableEntry(id, 'declaration_refused');
  }

  const admission = await admitToolInputSchema(candidate.tool.inputSchema);
  if (!admission.success) {
    logger.warn(
      `Refusing tool "${id}": ${admission.reason.replace('_', ' ')} for dialect "${admission.dialect}": ${admission.message}.`,
    );
    return unavailableEntry(id, 'declaration_refused');
  }

  const canonicalized = canonicalize({
    id,
    description: candidate.tool.description,
    inputSchema: admission.inputSchema,
  });
  assertModelToolDeclaration(canonicalized);
  const declaration = canonicalized;
  const declarationHash = hashToolDeclaration(declaration);
  return {
    admitted: {
      source: candidate.source,
      declaration,
      declarationHash,
      executor: candidate.tool,
    },
    entry: { id, state: 'available', declarationHash },
  };
}

/** The candidates worth naming an id for at all — allowlisted, read-only,
 * well-formed ids — grouped by case-folded id so a same-folded-id collision
 * is detectable before any of them is admitted. */
function groupEligibleTurnToolCandidates(
  candidates: ReadonlyArray<TurnToolCandidate>,
  allowedToolRules: ReadonlyArray<string>,
): Map<string, Array<TurnToolCandidate>> {
  const byFoldedId = new Map<string, Array<TurnToolCandidate>>();
  for (const candidate of candidates) {
    const id = candidateId(candidate);
    if (
      !isToolId(id) ||
      !candidateIsAllowlisted(candidate, id, allowedToolRules) ||
      candidateClassification(candidate) !== 'read_only'
    ) {
      continue;
    }
    const foldedId = asciiCaseFoldToolId(id);
    const group = byFoldedId.get(foldedId) ?? [];
    group.push(candidate);
    byFoldedId.set(foldedId, group);
  }
  return byFoldedId;
}

export async function composeTurnToolCatalog(input: {
  readonly allowedToolRules: ReadonlyArray<string>;
  readonly callTimeoutSeconds: number;
  readonly candidates: Iterable<TurnToolCandidate>;
}): Promise<TurnToolCatalog> {
  const byFoldedId = groupEligibleTurnToolCandidates(
    [...input.candidates],
    input.allowedToolRules,
  );

  const admitted: Array<AdmittedTurnTool> = [];
  const entries: Array<ToolAvailabilityEntry> = [];
  const sortedFoldedIds = [...byFoldedId.keys()].sort(compareCodePoints);
  for (const foldedId of sortedFoldedIds) {
    const group = byFoldedId.get(foldedId) ?? [];
    if (group.length !== 1) {
      entries.push(...collidingToolEntries(group));
      continue;
    }
    const outcome = await admitTurnToolCandidate(
      group[0],
      input.callTimeoutSeconds,
    );
    entries.push(outcome.entry);
    if (outcome.admitted) admitted.push(outcome.admitted);
  }

  admitted.sort((left, right) =>
    compareCodePoints(left.declaration.id, right.declaration.id),
  );
  entries.sort((left, right) => compareCodePoints(left.id, right.id));

  return {
    admitted,
    manifest: { version: 1, entries },
  };
}
