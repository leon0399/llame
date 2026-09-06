/**
 * The tool-availability context-item producer: split out of
 * context-item-producers.ts (a distinct, self-contained producer — closed
 * reason vocabularies, initial-vs-delta payload shapes, and the manifest
 * diff) purely to keep that file under its line budget. Re-exported from
 * context-item-producers.ts so existing importers are unaffected.
 */
import { type AuthoredContextItemPart } from './context-item';
import { compareCodePoints } from '../canonical-json';
import { isToolId } from '../tools/tool-id';
import {
  parseToolAvailabilityManifest,
  TOOL_UNAVAILABLE_REASON_LABELS,
  TOOL_UNAVAILABLE_REASONS,
  type ToolAvailabilityEntry,
  type ToolAvailabilityManifest,
  type ToolAvailabilityManifestV1,
  type ToolUnavailableReason,
} from '../tools/turn-tool-catalog';
import { isString, type UnknownRecord } from '@workspace/runtime-safety';
import {
  createRenderedContextItem,
  isExactRecord,
} from './context-item-shared';

export const TOOL_RECOVERY_REASONS = [
  'source_reconnected',
  'protocol_supported',
  'discovery_succeeded',
  'tool_restored',
  'declaration_accepted',
  'name_collision_resolved',
  // Legacy decode/recovery only; current candidates never author its source reason.
  'knowledge_space_configured',
  'knowledge_space_restored',
] as const;

export type ToolRecoveryReason = (typeof TOOL_RECOVERY_REASONS)[number];

export const TOOL_RECOVERY_REASON_LABELS = {
  source_reconnected: 'server reconnected',
  protocol_supported: 'protocol supported',
  discovery_succeeded: 'tool discovery succeeded',
  tool_restored: 'tool restored',
  declaration_accepted: 'tool declaration accepted',
  name_collision_resolved: 'tool name collision resolved',
  knowledge_space_configured: 'Knowledge Space configured',
  knowledge_space_restored: 'Knowledge Space restored',
} satisfies Readonly<Record<ToolRecoveryReason, string>>;

export const RECOVERY_REASON_BY_UNAVAILABLE_REASON = {
  source_connecting: 'source_reconnected',
  source_disconnected: 'source_reconnected',
  protocol_unsupported: 'protocol_supported',
  discovery_failed: 'discovery_succeeded',
  tool_missing: 'tool_restored',
  declaration_refused: 'declaration_accepted',
  name_collision: 'name_collision_resolved',
  knowledge_space_not_configured: 'knowledge_space_configured',
  knowledge_space_unavailable: 'knowledge_space_restored',
} satisfies Readonly<Record<ToolUnavailableReason, ToolRecoveryReason>>;

export type UnavailableTransition = {
  readonly id: string;
  readonly reason: ToolUnavailableReason;
};

export type RecoveryTransition = {
  readonly id: string;
  readonly reason: ToolRecoveryReason;
};

export interface ToolAvailabilityPayload extends UnknownRecord {
  readonly kind: 'initial' | 'delta';
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
  readonly unavailable: ReadonlyArray<UnavailableTransition>;
  readonly becameUnavailable: ReadonlyArray<UnavailableTransition>;
  readonly nowAvailable: ReadonlyArray<RecoveryTransition>;
}

function isSortedToolIdArray(value: unknown): value is Array<string> {
  if (!Array.isArray(value)) return false;
  let previous: string | undefined;
  for (const id of value) {
    if (
      !isString(id) ||
      !isToolId(id) ||
      (previous !== undefined && compareCodePoints(previous, id) >= 0)
    ) {
      return false;
    }
    previous = id;
  }
  return true;
}

function isReasonEntries<TReason extends string>(
  value: unknown,
  reasons: ReadonlyArray<TReason>,
): value is Array<{ id: string; reason: TReason }> {
  if (!Array.isArray(value)) return false;
  let previous: string | undefined;
  for (const entry of value) {
    if (
      !isExactRecord(entry, ['id', 'reason']) ||
      !isString(entry['id']) ||
      !isToolId(entry['id']) ||
      !isString(entry['reason']) ||
      !reasons.some((reason) => reason === entry['reason']) ||
      (previous !== undefined && compareCodePoints(previous, entry['id']) >= 0)
    ) {
      return false;
    }
    previous = entry['id'];
  }
  return true;
}

export function isToolAvailabilityPayload(
  value: unknown,
): value is ToolAvailabilityPayload {
  if (
    !isExactRecord(value, [
      'added',
      'becameUnavailable',
      'kind',
      'nowAvailable',
      'removed',
      'unavailable',
    ])
  ) {
    return false;
  }
  if (
    (value['kind'] !== 'initial' && value['kind'] !== 'delta') ||
    !isSortedToolIdArray(value['added']) ||
    !isSortedToolIdArray(value['removed']) ||
    !isReasonEntries(value['unavailable'], TOOL_UNAVAILABLE_REASONS) ||
    !isReasonEntries(value['becameUnavailable'], TOOL_UNAVAILABLE_REASONS) ||
    !isReasonEntries(value['nowAvailable'], TOOL_RECOVERY_REASONS)
  ) {
    return false;
  }
  // Rebuilt from the individually-narrowed fields above (not `value` itself,
  // whose own type flow analysis does not carry across the compound `||`
  // condition) so no assertion is needed here.
  return satisfiesToolAvailabilityInvariants({
    kind: value['kind'],
    added: value['added'],
    removed: value['removed'],
    unavailable: value['unavailable'],
    becameUnavailable: value['becameUnavailable'],
    nowAvailable: value['nowAvailable'],
  });
}

/** Once shape-checked: the two semantic invariants a valid payload must also satisfy. */
function satisfiesToolAvailabilityInvariants(
  value: ToolAvailabilityPayload,
): boolean {
  // An initial disclosure epoch has no prior manifest to diff against, so it
  // can only state what is currently unavailable.
  if (
    value.kind === 'initial' &&
    (value.added.length > 0 ||
      value.removed.length > 0 ||
      value.becameUnavailable.length > 0 ||
      value.nowAvailable.length > 0)
  ) {
    return false;
  }

  const allIds = [
    ...value.added,
    ...value.removed,
    ...value.unavailable.map(({ id }) => id),
    ...value.becameUnavailable.map(({ id }) => id),
    ...value.nowAvailable.map(({ id }) => id),
  ];
  return allIds.length > 0 && new Set(allIds).size === allIds.length;
}

export function createToolAvailabilityItem(input: {
  readonly runId: string;
  readonly payload: ToolAvailabilityPayload;
}): AuthoredContextItemPart {
  if (!isToolAvailabilityPayload(input.payload)) {
    throw new TypeError('Invalid server-authored tool availability metadata');
  }
  return createRenderedContextItem({
    producer: 'tool-availability',
    form: 'notice',
    runId: input.runId,
    payload: input.payload,
    body: renderToolAvailability(input.payload),
  });
}

function entriesById(
  manifest: ToolAvailabilityManifestV1,
): ReadonlyMap<string, ToolAvailabilityEntry> {
  return new Map(manifest.entries.map((entry) => [entry.id, entry]));
}

/**
 * Derive durable semantic metadata from immutable Run manifests, or `null`
 * when nothing changed — an unchanged outage emits no item, including while
 * the outage persists.
 *
 * Omitting the previous manifest starts a fresh disclosure epoch; a v0
 * manifest is also initial, because historical availability was never
 * observed. Compaction is what starts the next epoch, per the rail's single
 * re-baseline boundary.
 */
export function deriveToolAvailabilityPayload(input: {
  readonly current: ToolAvailabilityManifestV1;
  readonly previous?: ToolAvailabilityManifest;
}): ToolAvailabilityPayload | null {
  const current = parseToolAvailabilityManifest(input.current);
  if (current.version !== 1) {
    throw new TypeError('Current tool availability must be observed');
  }
  const previous =
    input.previous === undefined
      ? undefined
      : parseToolAvailabilityManifest(input.previous);

  return previous === undefined || previous.version === 0
    ? deriveInitialToolAvailabilityPayload(current)
    : deriveToolAvailabilityDelta(previous, current);
}

/** No prior manifest to diff against: state only what is currently unavailable. */
function deriveInitialToolAvailabilityPayload(
  current: ToolAvailabilityManifestV1,
): ToolAvailabilityPayload | null {
  const unavailable = current.entries.flatMap((entry) =>
    entry.state === 'unavailable'
      ? [{ id: entry.id, reason: entry.reason }]
      : [],
  );
  if (unavailable.length === 0) return null;
  return {
    kind: 'initial',
    added: [],
    removed: [],
    unavailable,
    becameUnavailable: [],
    nowAvailable: [],
  };
}

type ToolTransitionBuckets = {
  added: Array<string>;
  removed: Array<string>;
  unavailable: Array<UnavailableTransition>;
  becameUnavailable: Array<UnavailableTransition>;
  nowAvailable: Array<RecoveryTransition>;
};

/** Classify one id's before/after state and push it into its transition bucket. */
function applyToolTransition(
  id: string,
  prior: ToolAvailabilityEntry | undefined,
  next: ToolAvailabilityEntry | undefined,
  buckets: ToolTransitionBuckets,
): void {
  if (!prior && next?.state === 'available') {
    buckets.added.push(id);
  } else if (!prior && next?.state === 'unavailable') {
    buckets.unavailable.push({ id, reason: next.reason });
  } else if (prior && !next) {
    buckets.removed.push(id);
  } else if (prior?.state === 'available' && next?.state === 'unavailable') {
    buckets.becameUnavailable.push({ id, reason: next.reason });
  } else if (prior?.state === 'unavailable' && next?.state === 'available') {
    buckets.nowAvailable.push({
      id,
      reason: RECOVERY_REASON_BY_UNAVAILABLE_REASON[prior.reason],
    });
  }
}

/** Diff two observed manifests into the five transition categories. */
function deriveToolAvailabilityDelta(
  previous: ToolAvailabilityManifestV1,
  current: ToolAvailabilityManifestV1,
): ToolAvailabilityPayload | null {
  const before = entriesById(previous);
  const after = entriesById(current);
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort(
    compareCodePoints,
  );

  const buckets: ToolTransitionBuckets = {
    added: [],
    removed: [],
    unavailable: [],
    becameUnavailable: [],
    nowAvailable: [],
  };
  for (const id of ids) {
    applyToolTransition(id, before.get(id), after.get(id), buckets);
  }

  const { added, removed, unavailable, becameUnavailable, nowAvailable } =
    buckets;
  if (
    added.length === 0 &&
    removed.length === 0 &&
    unavailable.length === 0 &&
    becameUnavailable.length === 0 &&
    nowAvailable.length === 0
  ) {
    return null;
  }

  return { kind: 'delta', ...buckets };
}

function renderIds(ids: ReadonlyArray<string>): Array<string> {
  return ids.map((id) => `- \`${id}\``);
}

function renderReasons<TReason extends string>(
  entries: ReadonlyArray<{ id: string; reason: TReason }>,
  labels: Readonly<Record<TReason, string>>,
): Array<string> {
  return entries.map(({ id, reason }) => `- \`${id}\`: "${labels[reason]}"`);
}

function renderToolAvailability(payload: ToolAvailabilityPayload): string {
  const lines = [
    payload.kind === 'initial'
      ? 'Some eligible tools are unavailable for this turn:'
      : 'The available tools were changed since the last turn:',
  ];
  const groups: Array<[string, Array<string>]> = [
    ['Added tools:', renderIds(payload.added)],
    ['Removed tools:', renderIds(payload.removed)],
    [
      'Unavailable tools:',
      renderReasons(payload.unavailable, TOOL_UNAVAILABLE_REASON_LABELS),
    ],
    [
      'Became unavailable:',
      renderReasons(payload.becameUnavailable, TOOL_UNAVAILABLE_REASON_LABELS),
    ],
    [
      'Now available:',
      renderReasons(payload.nowAvailable, TOOL_RECOVERY_REASON_LABELS),
    ],
  ];
  for (const [heading, entries] of groups) {
    if (entries.length === 0) continue;
    lines.push('', heading, ...entries);
  }
  lines.push(
    '',
    'Do not simulate removed or unavailable tools or invent their results.',
  );
  return lines.join('\n');
}
