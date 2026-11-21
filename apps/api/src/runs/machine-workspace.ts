/**
 * Everything one attempt decides about the Machine a bound Workspace lives on
 * (remote-machines "An unreachable Machine does not detach its Workspace" and
 * "Machine Workspace skills come from the Machine").
 *
 * The decisions are pure of Nest, the database, and the logger: a Machine's
 * refusal is reported through the `warn` port the caller passes, and every
 * branch answers with the detach the attempt must apply or the Machine state it
 * must narrate. The service keeps only the database write and the narration
 * that follow from it.
 */

import { realpath, stat } from 'node:fs/promises';

import { type FsStatResult } from '@workspace/machine-protocol';

import { createWorkspaceMachineAvailabilityItem } from '../chats/machine-context-item-producers';
import { type AuthoredContextItemPart } from '../chats/context-item';
import { type WorkspaceDetachReason } from '../chats/workspace-binding';
import { type Chat } from '../db/schema';
import { createMachineInstructionProbe } from '../instructions/machine-instruction-scope';
import { type ReadPage } from '../instructions/instruction-files';
import { type MachineConnector } from '../machines/machine-connector.service';
import {
  MachineIdentityMismatchError,
  MachineUnavailableError,
} from '../machines/machine-session';
import {
  formatMachineLocator,
  parseMachineLocator,
} from '../machines/machine-locator';
import { readFsStatResult } from '../machines/machine-results';
import { SkillCatalog, type SkillCatalogPort } from '../skills/skill-catalog';
import {
  snapshotMachineSkillSources,
  type MachineSkillRequest,
} from '../skills/machine-skill-sources';
import {
  decidePermission,
  evaluateCanonicalWithRejectTexts,
} from '../tools/permissions/admit';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { type CompiledPolicy } from '../tools/permissions/types';
import { machineWorkspaceRoot } from '../tools/workspace-path';

import { type InRunAttempt } from './in-run-context-items';
import { machineAttemptKey, machineEnvelope } from './machine-attempt';

/**
 * Per-root skill-catalog snapshots kept for Machines, in insertion order. A
 * Machine snapshot is per attempt, and one attempt reads it many times, so a
 * handful of concurrently running Chats on Machines covers every attempt that
 * resolves a skill state; the oldest is dropped and then simply contributes no
 * workspace skills.
 */
const MACHINE_SKILL_CATALOG_LIMIT = 8;

/**
 * What this attempt decided about the Machine a bound Workspace lives on
 * (remote-machines "An unreachable Machine does not detach its Workspace"). The
 * Machine's operator-removal is the detach notice's story, so it travels as the
 * detach's `removedMachine`, never as an availability.
 */
export type MachineWorkspaceState = {
  readonly name: string;
  /** Whether the Machine answered during this attempt. */
  readonly available: boolean;
  /**
   * The operator removed this Machine, so its binding was detached with
   * `executor_absent` and the notice names the Machine that is gone.
   */
  readonly removed?: boolean;
};

/** The connector surface Machine preparation reads. */
export type MachinePreparationConnector = Pick<
  MachineConnector,
  | 'enabled'
  | 'isConfigured'
  | 'reachable'
  | 'request'
  | 'localMachine'
  | 'defaultMachine'
  | 'canReach'
  | 'verifyLocal'
>;

/** The attempt's Machine identity: where it goes, who it is, how long it may take. */
export type MachineAttemptIdentity = {
  readonly runId: string;
  /** The Run's native delivery sequence, when the attempt has one. */
  readonly deliverySequence?: number;
  readonly signal?: AbortSignal;
};

/** What became of the attempt's Machine binding. */
export type MachineWorkspaceDecision =
  | {
      readonly kind: 'detach';
      readonly reason: WorkspaceDetachReason;
      /** The Machine this detach removed from the binding, when it had one. */
      readonly removedMachine?: string;
    }
  | {
      readonly kind: 'unavailable';
      readonly machine: MachineWorkspaceState;
    }
  | {
      readonly kind: 'available';
      readonly machine: MachineWorkspaceState;
    };

/** Everything one attempt's Machine binding check reads. */
export type MachineWorkspaceRequest = {
  readonly connector: MachinePreparationConnector | undefined;
  readonly machineName: string;
  readonly root: string;
  readonly effectivePermissionMode: PermissionMode;
  readonly toolAllowlist: ReadonlyArray<string>;
  readonly permissionPolicy: CompiledPolicy;
  readonly identity: MachineAttemptIdentity;
  /** The bounded per-root catalog cache a kept Workspace adds to. */
  readonly skillCatalogs: Map<string, SkillCatalogPort>;
  readonly skillDirectories: ReadonlyArray<string>;
  /** Where a Machine's refusal of the root check is reported. */
  readonly warn: (message: string) => void;
};

/** The same, for a Machine whose connector is known to exist. */
type BoundMachineRequest = MachineWorkspaceRequest & {
  readonly connector: MachinePreparationConnector;
};

/** The binding check's outcome for a Machine that answered. */
type CheckedMachine =
  | { readonly kind: 'bound' }
  | { readonly kind: 'unavailable'; readonly machine: MachineWorkspaceState }
  | { readonly kind: 'detach'; readonly reason: WorkspaceDetachReason };

/**
 * The binding check for a Workspace on a Machine. An unreachable Machine is NOT
 * a detached Workspace: the binding persists, every operation that addresses
 * that Machine fails with `machine_unavailable`, and the attempt records the
 * availability transition it tells. Only a Machine the operator removed
 * detaches, narrated as a removed Machine.
 */
export async function decideMachineWorkspace(
  params: MachineWorkspaceRequest,
): Promise<MachineWorkspaceDecision> {
  const { connector, machineName } = params;

  if (
    connector === undefined ||
    !connector.enabled() ||
    !connector.isConfigured(machineName)
  ) {
    return {
      kind: 'detach',
      reason: 'executor_absent',
      removedMachine: machineName,
    };
  }

  // A declared entry without a destination is reachable only by the process
  // whose `machines.local` names it. This worker cannot reach it at all, which
  // is a mismatched Machine, not a Machine that went away for a while.
  if (!connector.canReach(machineName))
    return { kind: 'detach', reason: 'executor_mismatch' };

  const checked =
    machineName === connector.localMachine()
      ? await checkLocalMachine({ ...params, connector })
      : await checkBoundMachine({ ...params, connector });

  if (checked.kind !== 'bound') {
    params.skillCatalogs.delete(params.root);

    return checked;
  }

  await prepareMachineSkills(params.skillCatalogs, {
    connector,
    machineName,
    root: params.root,
    signal: params.identity.signal,
    toolAllowlist: params.toolAllowlist,
    skillDirectories: params.skillDirectories,
  });

  return {
    kind: 'available',
    machine: { name: machineName, available: true },
  };
}

/**
 * The binding check for a Workspace on this process's own Machine. The daemon
 * behind `machines.local` must answer and be bound to the identity this
 * installation stored, exactly as a remote daemon must; then the root is
 * re-checked in process, on the Machine's own filesystem.
 */
async function checkLocalMachine(
  params: BoundMachineRequest,
): Promise<CheckedMachine> {
  if (!(await localReachable(params.connector))) {
    // The local daemon refused, or answered under another identity: this
    // attempt tells the Machine as unavailable and keeps the binding. A
    // mismatch is never-sent, so nothing of the Chat's changed.
    return {
      kind: 'unavailable',
      machine: { name: params.machineName, available: false },
    };
  }

  return checkLocalRoot(params);
}

/**
 * Whether this process's own daemon answered and is bound to the identity this
 * installation stored. A refusal is an unavailable Machine, never a defect: it
 * fails the attempt's host operations and leaves the binding alone. Any other
 * failure rethrows.
 */
async function localReachable(
  connector: MachinePreparationConnector,
): Promise<boolean> {
  try {
    await connector.verifyLocal();

    return true;
  } catch (error) {
    if (
      error instanceof MachineUnavailableError ||
      error instanceof MachineIdentityMismatchError
    ) {
      return false;
    }

    throw error;
  }
}

/** The absolute path and canonical locator a stored root names on a Machine. */
function boundRoot(
  root: string,
  machineName: string,
): { readonly path: string; readonly locator: string } | undefined {
  const parsed = parseMachineLocator(root);

  if (parsed.kind === 'path') {
    if (parsed.name !== machineName) return undefined;
    const locator = formatMachineLocator(parsed.name, parsed.path);

    return locator === undefined ? undefined : { path: parsed.path, locator };
  }

  // A root stored before the canonical format is a bare absolute path on the
  // Machine the binding names (history replay).
  if (!root.startsWith('/') || root.startsWith('//')) return undefined;
  const locator = formatMachineLocator(machineName, root);

  return locator === undefined ? undefined : { path: root, locator };
}

/**
 * The in-process counterpart of the Machine's root re-check: the stored root
 * must still be an existing directory whose canonical form is the stored
 * locator, and the operator gates apply exactly as they do for a remote one.
 */
async function checkLocalRoot(
  params: BoundMachineRequest,
): Promise<CheckedMachine> {
  const bound = boundRoot(params.root, params.machineName);

  if (bound === undefined) return { kind: 'detach', reason: 'root_missing' };

  let canonical: string | undefined;

  try {
    const entry = await stat(bound.path);

    if (!entry.isDirectory()) return { kind: 'detach', reason: 'root_missing' };
    canonical = formatMachineLocator(
      params.machineName,
      await realpath(bound.path),
    );
  } catch {
    return { kind: 'detach', reason: 'root_missing' };
  }

  if (canonical !== bound.locator)
    return { kind: 'detach', reason: 'root_moved' };

  const reason = rootDetachReason(params, bound);

  return reason === undefined ? { kind: 'bound' } : { kind: 'detach', reason };
}

/** One `enter_workspace` call over `path`, for a permission text. */
function workspaceEntryCall(path: string) {
  return { toolId: 'enter_workspace', args: { path } };
}

/**
 * The operator gates every re-checked root passes once its canonical form
 * matched: `enter_workspace` must be allowlisted, and the saved policy must
 * allow the root (design D7). Both re-checks decide on the canonical locator
 * and keep a reject's effect in every spelling of the same path: the root's
 * decoded absolute path, and the stored text when it differs (a bare legacy
 * root, another percent spelling).
 */
function rootDetachReason(
  params: BoundMachineRequest,
  bound: { readonly path: string; readonly locator: string },
): WorkspaceDetachReason | undefined {
  if (!params.toolAllowlist.includes('enter_workspace'))
    return 'tool_not_allowed';

  const rejectTexts = [workspaceEntryCall(bound.path)];

  if (params.root !== bound.path && params.root !== bound.locator)
    rejectTexts.push(workspaceEntryCall(params.root));

  const decision = decidePermission(
    params.permissionPolicy,
    params.effectivePermissionMode,
    (evaluate) =>
      evaluateCanonicalWithRejectTexts(evaluate, {
        canonical: workspaceEntryCall(bound.locator),
        rejectTexts,
      }),
  );

  return decision.decision === 'allow' ? undefined : 'permission_rejected';
}

/**
 * The availability of the Machine an unbound Chat addresses: `machines.default`
 * decided once per attempt, the same way a bound Machine is. Absent without a
 * configured default, so no narration describes a Machine no path addresses.
 */
export async function decideUnboundMachine(params: {
  readonly connector: MachinePreparationConnector | undefined;
  readonly identity: MachineAttemptIdentity;
}): Promise<MachineWorkspaceState | undefined> {
  const { connector } = params;
  const name = connector?.defaultMachine();

  if (
    connector === undefined ||
    name === undefined ||
    !connector.enabled() ||
    !connector.isConfigured(name)
  ) {
    return undefined;
  }

  if (name === connector.localMachine()) {
    return { name, available: await localReachable(connector) };
  }

  const available =
    connector.canReach(name) &&
    (await connector.reachable(
      name,
      machineAttemptKey(
        params.identity.runId,
        params.identity.deliverySequence,
      ),
    ));

  return { name, available };
}

/**
 * The reachability verdict and the root re-check of the Machine this attempt is
 * bound to. Reachability is decided once per attempt: instructions, skills, MCP,
 * and the tools all read the same verdict instead of each waiting out a
 * handshake timeout. A Machine that cannot answer is told as unavailable, never
 * detached; a root that no longer checks out detaches with its reason.
 */
async function checkBoundMachine(
  params: BoundMachineRequest,
): Promise<CheckedMachine> {
  const available = await params.connector.reachable(
    params.machineName,
    machineAttemptKey(params.identity.runId, params.identity.deliverySequence),
  );

  if (!available) {
    return {
      kind: 'unavailable',
      machine: { name: params.machineName, available: false },
    };
  }

  const check = await checkMachineRoot(params);

  if (check.verdict === 'unavailable') {
    // The session died between the verdict and the re-check: the binding is
    // still the Machine's, and this attempt tells the unavailability.
    return {
      kind: 'unavailable',
      machine: { name: params.machineName, available: false },
    };
  }

  if (check.verdict === 'detach')
    return { kind: 'detach', reason: check.reason };

  return { kind: 'bound' };
}

/** What the Machine's own root re-check found. */
type MachineRootVerdict =
  | { readonly verdict: 'keep' }
  | { readonly verdict: 'unavailable' }
  | { readonly verdict: 'detach'; readonly reason: WorkspaceDetachReason };

/**
 * The Machine counterpart of the local Workspace detach check, run only once
 * the Machine answered: the registered root is re-probed through the Machine,
 * its canonical form must still be the bound locator, and the operator gates
 * apply exactly as they do locally.
 */
async function checkMachineRoot(
  params: BoundMachineRequest,
): Promise<MachineRootVerdict> {
  const bound = boundRoot(params.root, params.machineName);

  if (bound === undefined) return { verdict: 'detach', reason: 'root_missing' };

  const probe = await probeMachineRoot({
    connector: params.connector,
    machineName: params.machineName,
    path: bound.path,
    identity: params.identity,
    warn: params.warn,
  });

  if (probe.verdict !== 'probed') return probe;

  if (probe.stat === undefined || probe.stat.kind !== 'directory') {
    return { verdict: 'detach', reason: 'root_missing' };
  }

  const canonical =
    probe.stat.realPath === undefined
      ? undefined
      : formatMachineLocator(params.machineName, probe.stat.realPath);

  // A Machine that reports no real path (or a path this locator grammar cannot
  // spell) is not the bound root either: both detach as a moved root.
  if (canonical !== bound.locator) {
    return { verdict: 'detach', reason: 'root_moved' };
  }

  const reason = rootDetachReason(params, bound);

  return reason === undefined
    ? { verdict: 'keep' }
    : { verdict: 'detach', reason };
}

/**
 * One `fs.stat` of a bound Machine root. A lost session is its own verdict,
 * never a missing root: a Machine that went away must not detach a binding its
 * Chat would still have on its return.
 */
async function probeMachineRoot(params: {
  readonly connector: MachinePreparationConnector;
  readonly machineName: string;
  readonly path: string;
  readonly identity: MachineAttemptIdentity;
  readonly warn: (message: string) => void;
}): Promise<
  | { readonly verdict: 'probed'; readonly stat: FsStatResult | undefined }
  | { readonly verdict: 'unavailable' }
  | { readonly verdict: 'detach'; readonly reason: WorkspaceDetachReason }
> {
  try {
    return {
      verdict: 'probed',
      stat: readFsStatResult(
        await params.connector.request(
          params.machineName,
          'fs.stat',
          {
            envelope: machineEnvelope({
              runId: params.identity.runId,
              deliverySequence: params.identity.deliverySequence,
            }),
            path: params.path,
          },
          { signal: params.identity.signal },
        ),
      ),
    };
  } catch (error) {
    if (error instanceof MachineUnavailableError) {
      return { verdict: 'unavailable' };
    }

    // A daemon refusal — the path is no longer registered, the budget ran out —
    // leaves nothing this Chat can address, exactly as a root that is gone does.
    params.warn(
      `Machine ${params.machineName} refused the Workspace root check for ${params.path}`,
    );

    return { verdict: 'detach', reason: 'root_missing' };
  }
}

/**
 * The Machine Workspace's skill sources, read from the Machine once per attempt
 * (spec: Machine Workspace skills come from the Machine). The local catalog
 * still does the discovery, the bounds, and the precedence; it is simply fed an
 * in-memory filesystem built from a bounded Machine snapshot, so every later
 * `skill://` read of a Machine package reads the Machine and the hub's own
 * filesystem never sees a `machine://` path.
 */
export async function prepareMachineSkills(
  catalogs: Map<string, SkillCatalogPort>,
  params: {
    readonly connector: MachinePreparationConnector;
    readonly machineName: string;
    readonly root: string;
    readonly signal?: AbortSignal;
    readonly toolAllowlist: ReadonlyArray<string>;
    readonly skillDirectories: ReadonlyArray<string>;
  },
): Promise<void> {
  if (!params.toolAllowlist.includes('read')) return;
  const parsed = machineWorkspaceRoot(params.root);

  if (parsed === undefined || parsed.name !== params.machineName) return;

  // This process serves its own Machine in process (design D8): its binding
  // check already completed the identity-checked handshake above, and every
  // read of the host paths `workspaceSkillSources` derives for a local root
  // re-checks that handshake itself, so a snapshot would be the wrong
  // authority.
  if (params.machineName === params.connector.localMachine()) return;

  const request: MachineSkillRequest = (method, requestParams, options) =>
    params.connector.request(
      params.machineName,
      method,
      requestParams,
      options,
    );

  const sources = await snapshotMachineSkillSources({
    root: params.root,
    request,
    signal: params.signal,
  });

  if (sources === undefined) return;
  catalogs.set(
    params.root,
    new SkillCatalog(params.skillDirectories, sources.fileSystem),
  );

  while (catalogs.size > MACHINE_SKILL_CATALOG_LIMIT) {
    const oldest = catalogs.keys().next().value;

    if (oldest === undefined) break;
    catalogs.delete(oldest);
  }
}

/** The Chat row and the Machine state a successful detach leaves. */
export type DetachedBinding = {
  readonly chat: Chat | undefined;
  readonly machine?: MachineWorkspaceState;
};

/**
 * The Chat row a successful detach leaves, and the Machine state its notice
 * names. The detached Chat row is the local copy the attempt reads its
 * narration from, so the generation it reported and the reason it stores are
 * applied together. A detached Machine binding keeps the Machine's name, which
 * the row no longer holds, so the notice can name the Machine the operator
 * removed.
 */
export function detachedBinding(params: {
  readonly chat: Chat | undefined;
  readonly generation: number;
  readonly reason: WorkspaceDetachReason;
  /** The Machine this detach removed from the binding, when it had one. */
  readonly removedMachine?: string;
}): DetachedBinding {
  return {
    chat:
      params.chat === undefined
        ? undefined
        : {
            ...params.chat,
            workspaceRoot: null,
            workspaceExecutorId: null,
            workspaceGeneration: params.generation + 1,
            workspaceDetachReason: params.reason,
          },
    ...(params.removedMachine !== undefined && {
      machine: {
        name: params.removedMachine,
        available: false,
        removed: true,
      },
    }),
  };
}

/**
 * One narration per availability transition: the state the Chat was last told
 * about against the one this attempt decided. A removed Machine is the detach
 * notice's story, not this one.
 *
 * Nothing told yet (`null`) narrates only an unreachable Machine: a first
 * observation of a Machine that works is not a change, and a freshly entered
 * binding has nothing to recover from.
 */
export function machineAvailabilityNarration(params: {
  readonly runId: string;
  readonly machine: MachineWorkspaceState | undefined;
  readonly toldAvailable: Chat['workspaceToldAvailable'];
}):
  | { readonly part: AuthoredContextItemPart; readonly available: boolean }
  | undefined {
  const { machine } = params;

  if (machine === undefined || machine.removed === true) return undefined;

  // Reaching a Machine that was never told as lost is not a transition, and
  // an unreachable Machine already told as lost is not one either.
  const changed = machine.available
    ? params.toldAvailable === false
    : params.toldAvailable !== false;

  if (!changed) return undefined;

  return {
    part: createWorkspaceMachineAvailabilityItem({
      runId: params.runId,
      machine: machine.name,
      available: machine.available,
    }),
    available: machine.available,
  };
}

/**
 * Whether MACHINE instruction files may load: the same `read` allowlist and at
 * least one configured Machine. No local executor is needed — the chain is read
 * through the Machine, and the page reader is the same `read` tool the model's
 * own Machine reads use.
 */
export function machineInstructionAvailability(params: {
  readonly connector: { enabled(): boolean } | undefined;
  readonly toolAllowlist: ReadonlyArray<string>;
}): boolean {
  if (!params.toolAllowlist.includes('read')) return false;

  return params.connector?.enabled() === true;
}

/**
 * The Machine world one attempt may load Machine candidates in: absent without
 * `read` and a configured Machine, else the same audited page reader every
 * world uses and the registered-root probe of the targeted Machine.
 */
export function machineInstructionWorld(params: {
  readonly enabled: boolean;
  readonly connector: MachineConnector | undefined;
  readonly readPage: ReadPage;
  readonly identity: MachineAttemptIdentity;
}): InRunAttempt['machines'] {
  if (!params.enabled || params.connector === undefined) return undefined;

  return {
    readPage: params.readPage,
    probe: createMachineInstructionProbe({
      connector: params.connector,
      envelope: machineEnvelope({
        runId: params.identity.runId,
        deliverySequence: params.identity.deliverySequence,
      }),
      signal: params.identity.signal,
    }),
  };
}
