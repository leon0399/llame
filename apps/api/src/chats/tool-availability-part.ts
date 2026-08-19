import { compareCodePoints } from '../canonical-json';
import {
  parseToolAvailabilityManifest,
  TOOL_UNAVAILABLE_REASON_LABELS,
  TOOL_UNAVAILABLE_REASONS,
  type ToolAvailabilityEntry,
  type ToolAvailabilityManifest,
  type ToolAvailabilityManifestV1,
  type ToolUnavailableReason,
} from '../tools/turn-tool-catalog';
import { isToolId } from '../tools/tool-id';

export const TOOL_RECOVERY_REASONS = [
  'source_reconnected',
  'protocol_supported',
  'discovery_succeeded',
  'tool_restored',
  'declaration_accepted',
  'name_collision_resolved',
] as const;

export type ToolRecoveryReason = (typeof TOOL_RECOVERY_REASONS)[number];

export const TOOL_RECOVERY_REASON_LABELS: Readonly<
  Record<ToolRecoveryReason, string>
> = {
  source_reconnected: 'server reconnected',
  protocol_supported: 'protocol supported',
  discovery_succeeded: 'tool discovery succeeded',
  tool_restored: 'tool restored',
  declaration_accepted: 'tool declaration accepted',
  name_collision_resolved: 'tool name collision resolved',
};

const RECOVERY_REASON_BY_UNAVAILABLE_REASON: Readonly<
  Record<ToolUnavailableReason, ToolRecoveryReason>
> = {
  source_connecting: 'source_reconnected',
  source_disconnected: 'source_reconnected',
  protocol_unsupported: 'protocol_supported',
  discovery_failed: 'discovery_succeeded',
  tool_missing: 'tool_restored',
  declaration_refused: 'declaration_accepted',
  name_collision: 'name_collision_resolved',
};

type UnavailableTransition = {
  readonly id: string;
  readonly reason: ToolUnavailableReason;
};

type RecoveryTransition = {
  readonly id: string;
  readonly reason: ToolRecoveryReason;
};

export interface ToolAvailabilityPart {
  readonly type: 'data-tool-availability';
  readonly data: {
    readonly version: 1;
    readonly kind: 'initial' | 'delta';
    readonly runId: string;
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly unavailable: readonly UnavailableTransition[];
    readonly becameUnavailable: readonly UnavailableTransition[];
    readonly nowAvailable: readonly RecoveryTransition[];
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort(compareCodePoints).join('\0') ===
      [...expectedKeys].sort(compareCodePoints).join('\0')
  );
}

function isSortedToolIdArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  let previous: string | undefined;
  for (const id of value) {
    if (
      typeof id !== 'string' ||
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
  reasons: readonly TReason[],
): value is Array<{ id: string; reason: TReason }> {
  if (!Array.isArray(value)) return false;
  let previous: string | undefined;
  for (const entry of value) {
    if (
      !isExactRecord(entry, ['id', 'reason']) ||
      !isToolId(entry['id']) ||
      typeof entry['reason'] !== 'string' ||
      !(reasons as readonly string[]).includes(entry['reason']) ||
      (previous !== undefined && compareCodePoints(previous, entry['id']) >= 0)
    ) {
      return false;
    }
    previous = entry['id'];
  }
  return true;
}

/** Strict persisted-shape validation. Authoring remains server-only. */
export function isToolAvailabilityPart(
  value: unknown,
): value is ToolAvailabilityPart {
  if (
    !isExactRecord(value, ['data', 'type']) ||
    value['type'] !== 'data-tool-availability' ||
    !isExactRecord(value['data'], [
      'added',
      'becameUnavailable',
      'kind',
      'nowAvailable',
      'removed',
      'runId',
      'unavailable',
      'version',
    ])
  ) {
    return false;
  }

  const data = value['data'];
  if (
    data['version'] !== 1 ||
    (data['kind'] !== 'initial' && data['kind'] !== 'delta') ||
    typeof data['runId'] !== 'string' ||
    !UUID_PATTERN.test(data['runId']) ||
    !isSortedToolIdArray(data['added']) ||
    !isSortedToolIdArray(data['removed']) ||
    !isReasonEntries(data['unavailable'], TOOL_UNAVAILABLE_REASONS) ||
    !isReasonEntries(data['becameUnavailable'], TOOL_UNAVAILABLE_REASONS) ||
    !isReasonEntries(data['nowAvailable'], TOOL_RECOVERY_REASONS)
  ) {
    return false;
  }

  if (
    data['kind'] === 'initial' &&
    (data['added'].length > 0 ||
      data['removed'].length > 0 ||
      data['becameUnavailable'].length > 0 ||
      data['nowAvailable'].length > 0)
  ) {
    return false;
  }

  const allIds = [
    ...data['added'],
    ...data['removed'],
    ...data['unavailable'].map(({ id }) => id),
    ...data['becameUnavailable'].map(({ id }) => id),
    ...data['nowAvailable'].map(({ id }) => id),
  ];
  return allIds.length > 0 && new Set(allIds).size === allIds.length;
}

function createPart(data: ToolAvailabilityPart['data']): ToolAvailabilityPart {
  const part: ToolAvailabilityPart = {
    type: 'data-tool-availability',
    data,
  };
  if (!isToolAvailabilityPart(part)) {
    throw new TypeError('Invalid server-authored tool availability metadata');
  }
  return part;
}

function entriesById(
  manifest: ToolAvailabilityManifestV1,
): ReadonlyMap<string, ToolAvailabilityEntry> {
  return new Map(manifest.entries.map((entry) => [entry.id, entry]));
}

/**
 * Derive durable semantic metadata from immutable Run manifests. Omitting the
 * previous manifest starts a fresh disclosure epoch; v0 is also initial because
 * historical availability was never observed.
 */
export function createToolAvailabilityPart(input: {
  readonly runId: string;
  readonly current: ToolAvailabilityManifestV1;
  readonly previous?: ToolAvailabilityManifest;
}): ToolAvailabilityPart | null {
  const current = parseToolAvailabilityManifest(input.current);
  if (current.version !== 1) {
    throw new TypeError('Current tool availability must be observed');
  }
  const previous =
    input.previous === undefined
      ? undefined
      : parseToolAvailabilityManifest(input.previous);

  if (previous === undefined || previous.version === 0) {
    const unavailable = current.entries.flatMap((entry) =>
      entry.state === 'unavailable'
        ? [{ id: entry.id, reason: entry.reason }]
        : [],
    );
    if (unavailable.length === 0) return null;
    return createPart({
      version: 1,
      kind: 'initial',
      runId: input.runId,
      added: [],
      removed: [],
      unavailable,
      becameUnavailable: [],
      nowAvailable: [],
    });
  }

  const before = entriesById(previous);
  const after = entriesById(current);
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort(
    compareCodePoints,
  );
  const added: string[] = [];
  const removed: string[] = [];
  const unavailable: UnavailableTransition[] = [];
  const becameUnavailable: UnavailableTransition[] = [];
  const nowAvailable: RecoveryTransition[] = [];

  for (const id of ids) {
    const prior = before.get(id);
    const next = after.get(id);
    if (!prior && next?.state === 'available') {
      added.push(id);
    } else if (!prior && next?.state === 'unavailable') {
      unavailable.push({ id, reason: next.reason });
    } else if (prior && !next) {
      removed.push(id);
    } else if (prior?.state === 'available' && next?.state === 'unavailable') {
      becameUnavailable.push({ id, reason: next.reason });
    } else if (prior?.state === 'unavailable' && next?.state === 'available') {
      nowAvailable.push({
        id,
        reason: RECOVERY_REASON_BY_UNAVAILABLE_REASON[prior.reason],
      });
    }
  }

  if (
    added.length === 0 &&
    removed.length === 0 &&
    unavailable.length === 0 &&
    becameUnavailable.length === 0 &&
    nowAvailable.length === 0
  ) {
    return null;
  }

  return createPart({
    version: 1,
    kind: 'delta',
    runId: input.runId,
    added,
    removed,
    unavailable,
    becameUnavailable,
    nowAvailable,
  });
}

function renderIds(ids: readonly string[]): string[] {
  return ids.map((id) => `- \`${id}\``);
}

function renderReasons<TReason extends string>(
  entries: readonly { id: string; reason: TReason }[],
  labels: Readonly<Record<TReason, string>>,
): string[] {
  return entries.map(({ id, reason }) => `- \`${id}\`: "${labels[reason]}"`);
}

export function renderToolAvailabilityReminder(
  part: ToolAvailabilityPart,
): string {
  if (!isToolAvailabilityPart(part)) {
    throw new TypeError('Invalid tool availability metadata');
  }

  const lines = [
    '<runtime-tool-availability>',
    part.data.kind === 'initial'
      ? 'Some eligible tools are unavailable for this turn:'
      : 'The available tools were changed since the last turn:',
  ];
  const groups: Array<[string, string[]]> = [
    ['Added tools:', renderIds(part.data.added)],
    ['Removed tools:', renderIds(part.data.removed)],
    [
      'Unavailable tools:',
      renderReasons(part.data.unavailable, TOOL_UNAVAILABLE_REASON_LABELS),
    ],
    [
      'Became unavailable:',
      renderReasons(
        part.data.becameUnavailable,
        TOOL_UNAVAILABLE_REASON_LABELS,
      ),
    ],
    [
      'Now available:',
      renderReasons(part.data.nowAvailable, TOOL_RECOVERY_REASON_LABELS),
    ],
  ];
  for (const [heading, entries] of groups) {
    if (entries.length === 0) continue;
    lines.push('', heading, ...entries);
  }
  lines.push(
    '',
    'Do not simulate removed or unavailable tools or invent their results.',
    '</runtime-tool-availability>',
  );
  return lines.join('\n');
}
