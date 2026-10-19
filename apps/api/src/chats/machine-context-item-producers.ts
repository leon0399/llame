/**
 * The Machine context-item producers: the Machine branches of the `workspace`
 * producer — the snapshot body for a Machine root, the availability transition
 * of the bound Machine, and the Machine name guard the Workspace detach
 * payload shares. Split out of context-item-producers.ts (a distinct,
 * self-contained slice of the Workspace producer) purely to keep that file
 * under its line budget.
 */

import { MACHINE_NAME_PATTERN } from '../machines/machine-locator';
import { loadPackagedTemplate } from '../prompts/template-engine';
import { machineWorkspaceRoot } from '../tools/workspace-path';
import { isString, type UnknownRecord } from '@workspace/runtime-safety';
import type { AuthoredContextItemPart } from './context-item';
import {
  createRenderedContextItem,
  isExactRecord,
} from './context-item-shared';

export interface WorkspaceMachinePayload extends UnknownRecord {
  readonly machine: string;
}

/** A Machine name is an operator configuration key, never free text. */
export function isMachineName(value: unknown): value is string {
  return isString(value) && MACHINE_NAME_PATTERN.test(value);
}

export function isWorkspaceMachinePayload(
  value: WorkspaceMachinePayload,
): value is WorkspaceMachinePayload;
export function isWorkspaceMachinePayload(
  value: unknown,
): value is WorkspaceMachinePayload;
export function isWorkspaceMachinePayload(
  value: unknown,
): value is WorkspaceMachinePayload {
  return isExactRecord(value, ['machine']) && isMachineName(value['machine']);
}

const renderMachineWorkspaceSnapshotTemplate = loadPackagedTemplate<{
  readonly root: string;
  readonly machine: string;
}>(__dirname, 'workspace-snapshot-machine');

const renderMachineUnavailableTemplate = loadPackagedTemplate<{
  readonly machine: string;
}>(__dirname, 'workspace-machine-unavailable');

const renderMachineRecoveredTemplate = loadPackagedTemplate<{
  readonly machine: string;
}>(__dirname, 'workspace-machine-recovered');

/**
 * The snapshot body when the Workspace root is on a Machine, and `undefined`
 * when it is a local path.
 *
 * A Machine root narrates the Machine's own authority, not the hub's: the
 * commands run as that Machine's OS user, which hub users share.
 */
export function renderMachineWorkspaceSnapshot(
  root: string,
): string | undefined {
  const machine = machineWorkspaceRoot(root);
  if (machine === undefined) return undefined;
  return renderMachineWorkspaceSnapshotTemplate({
    root,
    machine: machine.name,
  });
}

/**
 * One availability transition of the bound Machine, told exactly once: the
 * transition the Chat's recorded availability disagrees with. Both directions
 * are the same producer and form as the detach notice — a one-off statement
 * about the binding, not a snapshot that supersedes an earlier one.
 */
export function createWorkspaceMachineAvailabilityItem(input: {
  readonly runId: string;
  readonly machine: string;
  readonly available: boolean;
}): AuthoredContextItemPart {
  const payload: WorkspaceMachinePayload = { machine: input.machine };
  if (!isWorkspaceMachinePayload(payload)) {
    throw new TypeError('Invalid server-authored Workspace Machine metadata');
  }
  return createRenderedContextItem({
    producer: 'workspace',
    form: 'notice',
    runId: input.runId,
    payload,
    body: input.available
      ? renderMachineRecoveredTemplate({ machine: input.machine })
      : renderMachineUnavailableTemplate({ machine: input.machine }),
  });
}
