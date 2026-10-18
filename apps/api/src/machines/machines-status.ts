/**
 * Machine status: the closed vocabulary, the bounded shapes, and the pure
 * derivation the table, the probe, the connector's contact events, and
 * `GET /api/v1/machines` all agree on (remote-machines spec "Machine status is
 * derived from contact and visible" and design D9). Nothing here touches the
 * database or SSH, so both the unit suite and the integration suite can pin
 * the derivation without a Machine.
 */

import { PROTOCOL_VERSION } from '@workspace/machine-protocol';

/** The closed set of failure reasons; the table's CHECK mirrors it. */
export const MACHINE_FAILURE_REASONS = [
  'unreachable',
  'host_key_mismatch',
  'auth_failed',
  'incompatible_version',
  'session_lost',
] as const;

export type MachineFailureReason = (typeof MACHINE_FAILURE_REASONS)[number];

export function isMachineFailureReason(value: unknown): value is MachineFailureReason {
  return (
    typeof value === 'string' && MACHINE_FAILURE_REASONS.some((reason) => reason === value)
  );
}

/**
 * The inactivity window: a Machine whose last successful contact is older than
 * this reads offline, which is what keeps a crashed hub process from leaving a
 * Machine online forever.
 */
export const MACHINE_ONLINE_WINDOW_MS = 150_000;

/** Bounds on daemon-supplied strings before they reach a row or a response. */
export const MACHINE_ROOTS_LIMIT = 64;
export const MACHINE_ROOT_MAX_LENGTH = 4096;
export const MACHINE_VERSION_MAX_LENGTH = 128;

/** One observed contact with a Machine: a handshake, or a failed one. */
export type MachineContact = {
  readonly name: string;
  readonly at: Date;
  readonly hubProtocolVersion: number;
  /** Present on a handshake; absent when the contact failed before it. */
  readonly daemonProtocolVersion?: number;
  readonly daemonVersion?: string;
  readonly roots?: ReadonlyArray<string>;
  /** Present when the contact failed. */
  readonly failure?: MachineFailureReason;
};

/**
 * One `machines_status` row, as both readers and writers see it. The contact
 * timestamps are null together for a Machine llame has only ever failed to
 * reach: a failure is not a contact.
 */
export type MachineStatusRow = {
  readonly name: string;
  readonly firstContactAt: Date | null;
  readonly lastContactAt: Date | null;
  readonly lastFailureAt: Date | null;
  readonly lastFailureReason: MachineFailureReason | null;
  readonly hubProtocolVersion: number;
  readonly daemonProtocolVersion: number | null;
  readonly daemonVersion: string | null;
  readonly roots: ReadonlyArray<string>;
  readonly updatedAt: Date;
};

export type MachineStatus = 'online' | 'offline';

/**
 * Online means: the last SUCCESSFUL contact is inside the window AND after the
 * last failure. A failure is not a contact (status is derived from contact),
 * so a failed handshake alone never makes a Machine look alive, and a tie
 * between the two instants reads offline.
 */
export function deriveMachineStatus(
  lastContactAt: Date | null,
  lastFailureAt: Date | null,
  now: number,
): MachineStatus {
  if (lastContactAt === null) return 'offline';
  if (now - lastContactAt.getTime() > MACHINE_ONLINE_WINDOW_MS) return 'offline';
  if (lastFailureAt !== null && lastFailureAt.getTime() >= lastContactAt.getTime())
    return 'offline';
  return 'online';
}

/**
 * The registered roots a Machine reported, bounded and normalized: absolute
 * POSIX paths only, deduplicated in order, at most {@link MACHINE_ROOTS_LIMIT}
 * of them, each at most {@link MACHINE_ROOT_MAX_LENGTH} characters. A Machine
 * is untrusted input, so nothing it sends reaches a column or a response
 * unbounded.
 */
export function boundMachineRoots(
  roots: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
  if (roots === undefined) return [];
  const bounded: Array<string> = [];
  for (const root of roots) {
    if (bounded.length >= MACHINE_ROOTS_LIMIT) break;
    if (!root.startsWith('/')) continue;
    const text = root.slice(0, MACHINE_ROOT_MAX_LENGTH);
    if (!bounded.includes(text)) bounded.push(text);
  }
  return bounded;
}

/** A daemon-reported version, or undefined when it is empty or unusable. */
export function boundMachineVersion(version: string | undefined): string | undefined {
  if (version === undefined) return undefined;
  const text = version.slice(0, MACHINE_VERSION_MAX_LENGTH).trim();
  return text === '' ? undefined : text;
}

/** What `GET /api/v1/machines` serves for one configured Machine. */
export type MachineStatusView = {
  readonly name: string;
  readonly status: MachineStatus;
  readonly lastSeenAt: string | null;
  readonly failureReason: MachineFailureReason | null;
  readonly hubProtocolVersion: number;
  readonly daemonProtocolVersion: number | null;
  readonly daemonVersion: string | null;
  readonly roots: ReadonlyArray<string>;
};

/**
 * One Machine's view. A configured Machine llame has never contacted is
 * offline with no versions, not absent: the list is the configured Machines,
 * and status is their contact history. The hub protocol version the hub speaks
 * is reported even before a first contact, because it is the hub's own.
 */
export function machineStatusView(
  name: string,
  row: MachineStatusRow | undefined,
  now: number,
): MachineStatusView {
  if (row === undefined)
    return {
      name,
      status: 'offline',
      lastSeenAt: null,
      failureReason: null,
      hubProtocolVersion: PROTOCOL_VERSION,
      daemonProtocolVersion: null,
      daemonVersion: null,
      roots: [],
    };
  return {
    name: row.name,
    status: deriveMachineStatus(row.lastContactAt, row.lastFailureAt, now),
    lastSeenAt: row.lastContactAt?.toISOString() ?? null,
    failureReason: row.lastFailureReason,
    hubProtocolVersion: row.hubProtocolVersion,
    daemonProtocolVersion: row.daemonProtocolVersion,
    daemonVersion: row.daemonVersion,
    roots: row.roots,
  };
}
