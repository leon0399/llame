import { type JsonValue } from '@workspace/machine-protocol';

import {
  MachineConnector,
  MachineUnavailableError,
} from '../machines/machine-connector.service';
import { type Chat } from '../db/schema';
import { type ReadPage } from '../instructions/instruction-files';
import { type SkillCatalogPort } from '../skills/skill-catalog';
import {
  createProtocolPeer,
  type ProtocolPeer,
} from '../testing/machine-protocol-peer';
import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import { MACHINE_PREPARATION_BUDGET_MS } from './machine-attempt';
import {
  decideMachineWorkspace,
  detachedBinding,
  machineAvailabilityNarration,
  machineInstructionAvailability,
  machineInstructionWorld,
  prepareMachineSkills,
  type MachineAttemptIdentity,
  type MachinePreparationConnector,
  type MachineWorkspaceRequest,
  type MachineWorkspaceState,
} from './machine-workspace';

type RecordedRequest = {
  readonly name: string;
  readonly method: string;
  readonly params: unknown;
  readonly signal: AbortSignal | undefined;
};

const MACHINE_ROOT = 'machine://devl/srv/app';

/** The Run id every authored context item is validated against. */
const RUN_ID = '11111111-2222-4333-8444-555555555555';

const chat: Chat = {
  id: 'chat-1',
  ownerUserId: 'user-1',
  title: null,
  visibility: 'private',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
  projectId: null,
  recencyDigestBaseline: null,
  recencyDigestTold: null,
  recencyDigestRebakedFrom: null,
  skillCatalogBaseline: null,
  skillCatalogRebakedFrom: null,
  skillCatalogTold: null,
  workspaceRoot: MACHINE_ROOT,
  workspaceExecutorId: 'machine:devl',
  workspaceGeneration: 3,
  workspaceTold: null,
  workspaceToldFrom: null,
  workspaceToldAvailable: null,
  workspaceDetachReason: null,
};

const allowWorkspaceEntry = compileToolPermissionMap(
  { read: { allow: true }, enter_workspace: { allow: true } },
  'test-policy',
);
/** The same policy without an `enter_workspace` allow: the group is absent. */
const denyWorkspaceEntry = compileToolPermissionMap(
  { read: { allow: true } },
  'test-policy',
);

/** A connector fixture: the port it exposes, its requests, and its verdict keys. */
type RecordingConnector = {
  readonly connector: MachinePreparationConnector;
  readonly calls: Array<RecordedRequest>;
  readonly reachability: Array<string>;
};

function fakeConnector(
  options: {
    readonly enabled?: boolean;
    readonly configured?: ReadonlyArray<string>;
    readonly reachable?: boolean;
    readonly answer?: () => Promise<JsonValue>;
  } = {},
): RecordingConnector {
  const calls: Array<RecordedRequest> = [];
  const reachability: Array<string> = [];
  const configured = options.configured ?? ['devl'];
  return {
    calls,
    reachability,
    connector: {
      enabled: () => options.enabled ?? true,
      isConfigured: (name: string) => configured.includes(name),
      reachable: (name: string, attemptKey: string) => {
        reachability.push(`${name}\u0000${attemptKey}`);
        return Promise.resolve(options.reachable ?? true);
      },
      request: (name, method, params, requestOptions) => {
        calls.push({ name, method, params, signal: requestOptions?.signal });
        return (
          options.answer?.() ??
          Promise.resolve({
            kind: 'directory',
            isLink: false,
            realPath: '/srv/app',
          })
        );
      },
    },
  };
}

function decisionInput(
  connector: MachinePreparationConnector | undefined,
  overrides: Partial<MachineWorkspaceRequest> = {},
): MachineWorkspaceRequest {
  return {
    connector,
    machineName: 'devl',
    root: MACHINE_ROOT,
    effectivePermissionMode: 'default',
    toolAllowlist: ['read', 'enter_workspace'],
    permissionPolicy: allowWorkspaceEntry,
    identity: { runId: 'run-1', deliverySequence: 4 },
    skillCatalogs: new Map<string, SkillCatalogPort>(),
    skillDirectories: [],
    warn: vi.fn(),
    ...overrides,
  };
}

describe('decideMachineWorkspace', () => {
  it('detaches with executor_absent and the removed Machine when no connector exists', async () => {
    await expect(
      decideMachineWorkspace(decisionInput(undefined)),
    ).resolves.toEqual({
      kind: 'detach',
      reason: 'executor_absent',
      removedMachine: 'devl',
    });
  });

  it('detaches when Machines are disabled, and asks no Machine anything', async () => {
    const machine = fakeConnector({ enabled: false });
    await expect(
      decideMachineWorkspace(decisionInput(machine.connector)),
    ).resolves.toEqual({
      kind: 'detach',
      reason: 'executor_absent',
      removedMachine: 'devl',
    });
    expect(machine.reachability).toEqual([]);
    expect(machine.calls).toEqual([]);
  });

  it('detaches when the operator no longer configures the Machine', async () => {
    const machine = fakeConnector({ configured: ['gpu'] });
    await expect(
      decideMachineWorkspace(decisionInput(machine.connector)),
    ).resolves.toEqual({
      kind: 'detach',
      reason: 'executor_absent',
      removedMachine: 'devl',
    });
    expect(machine.reachability).toEqual([]);
  });

  it('tells unavailability without detaching when the Machine does not answer', async () => {
    const machine = fakeConnector({ reachable: false });
    await expect(
      decideMachineWorkspace(decisionInput(machine.connector)),
    ).resolves.toEqual({
      kind: 'unavailable',
      machine: { name: 'devl', available: false },
    });
    // One verdict per attempt, under the attempt's own key, and no root probe
    // after the verdict said the Machine is not there.
    expect(machine.reachability).toEqual([`devl\u0000run-1\u00004`]);
    expect(machine.calls).toEqual([]);
  });

  it('drops the skill snapshot of an earlier attempt when the Machine does not answer', async () => {
    const reachable = fakeConnector();
    const input = decisionInput(reachable.connector);
    await decideMachineWorkspace(input);
    expect(input.skillCatalogs.has(MACHINE_ROOT)).toBe(true);

    const unreachable = fakeConnector({ reachable: false });
    await decideMachineWorkspace({
      ...input,
      connector: unreachable.connector,
    });
    expect(input.skillCatalogs.has(MACHINE_ROOT)).toBe(false);
  });

  it('keeps the binding with the Machine available when its root still checks out', async () => {
    const machine = fakeConnector();
    const input = decisionInput(machine.connector);
    await expect(decideMachineWorkspace(input)).resolves.toEqual({
      kind: 'available',
      machine: { name: 'devl', available: true },
    });
    expect(machine.calls[0]).toEqual({
      name: 'devl',
      method: 'fs.stat',
      params: {
        envelope: {
          runId: 'run-1',
          deliverySeq: 4,
          budgetMs: MACHINE_PREPARATION_BUDGET_MS,
        },
        path: '/srv/app',
      },
      signal: undefined,
    });
    expect(input.skillCatalogs.has(MACHINE_ROOT)).toBe(true);
  });

  it('detaches root_missing when the binding names no Machine path', async () => {
    const machine = fakeConnector();
    await expect(
      decideMachineWorkspace(
        decisionInput(machine.connector, { root: 'machine://devl' }),
      ),
    ).resolves.toEqual({ kind: 'detach', reason: 'root_missing' });
    expect(machine.calls).toEqual([]);
  });

  it.each([
    { name: 'the root is gone', stat: { kind: 'missing', isLink: false } },
    { name: 'the root is no directory', stat: { kind: 'file', isLink: false } },
    {
      name: 'the answer is not an fs.stat result',
      stat: { kind: 42 },
    },
  ])('detaches root_missing when $name', async ({ stat }) => {
    const machine = fakeConnector({ answer: () => Promise.resolve(stat) });
    await expect(
      decideMachineWorkspace(decisionInput(machine.connector)),
    ).resolves.toEqual({ kind: 'detach', reason: 'root_missing' });
  });

  it.each([
    { name: 'the Machine reports no real path', realPath: undefined },
    { name: 'the real path is another locator', realPath: '/srv/elsewhere' },
  ])('detaches root_moved when $name', async ({ realPath }) => {
    const machine = fakeConnector({
      answer: () =>
        Promise.resolve({
          kind: 'directory',
          isLink: false,
          ...(realPath !== undefined && { realPath }),
        }),
    });
    await expect(
      decideMachineWorkspace(decisionInput(machine.connector)),
    ).resolves.toEqual({ kind: 'detach', reason: 'root_moved' });
  });

  it('detaches tool_not_allowed without enter_workspace on the allowlist', async () => {
    const machine = fakeConnector();
    await expect(
      decideMachineWorkspace(
        decisionInput(machine.connector, { toolAllowlist: ['read'] }),
      ),
    ).resolves.toEqual({ kind: 'detach', reason: 'tool_not_allowed' });
  });

  it('keeps the binding in bypass without consulting the policy', async () => {
    const machine = fakeConnector();
    await expect(
      decideMachineWorkspace(
        decisionInput(machine.connector, {
          effectivePermissionMode: 'bypass',
          permissionPolicy: denyWorkspaceEntry,
        }),
      ),
    ).resolves.toEqual({
      kind: 'available',
      machine: { name: 'devl', available: true },
    });
  });

  it('detaches permission_rejected when the policy does not allow the entry', async () => {
    const machine = fakeConnector();
    await expect(
      decideMachineWorkspace(
        decisionInput(machine.connector, {
          permissionPolicy: denyWorkspaceEntry,
        }),
      ),
    ).resolves.toEqual({ kind: 'detach', reason: 'permission_rejected' });
  });

  it('tells unavailability when the session dies between the verdict and the probe', async () => {
    const machine = fakeConnector({
      answer: () =>
        Promise.reject(
          new MachineUnavailableError('devl', 'unreachable', false, 'lost'),
        ),
    });
    const input = decisionInput(machine.connector);
    await expect(decideMachineWorkspace(input)).resolves.toEqual({
      kind: 'unavailable',
      machine: { name: 'devl', available: false },
    });
    // A lost session is not a refusal: nothing is reported as a refusal.
    expect(input.warn).not.toHaveBeenCalled();
  });

  it('detaches root_missing and reports the refusal for any other daemon failure', async () => {
    const machine = fakeConnector({
      answer: () => Promise.reject(new Error('machine_error: not registered')),
    });
    const input = decisionInput(machine.connector);
    await expect(decideMachineWorkspace(input)).resolves.toEqual({
      kind: 'detach',
      reason: 'root_missing',
    });
    expect(input.warn).toHaveBeenCalledWith(
      'Machine devl refused the Workspace root check for /srv/app',
    );
  });

  it('carries the run signal on the root probe', async () => {
    const signal = new AbortController().signal;
    const machine = fakeConnector();
    await decideMachineWorkspace(
      decisionInput(machine.connector, {
        identity: { runId: 'run-1', deliverySequence: 4, signal },
      }),
    );
    expect(machine.calls[0]?.signal).toBe(signal);
  });
});

describe('prepareMachineSkills', () => {
  it('reads nothing without read on the allowlist', async () => {
    const machine = fakeConnector();
    const catalogs = new Map<string, SkillCatalogPort>();
    await prepareMachineSkills(catalogs, {
      connector: machine.connector,
      machineName: 'devl',
      root: MACHINE_ROOT,
      toolAllowlist: ['enter_workspace'],
      skillDirectories: [],
    });
    expect(catalogs.size).toBe(0);
    expect(machine.calls).toEqual([]);
  });

  it('reads nothing when the root names another Machine', async () => {
    const machine = fakeConnector();
    const catalogs = new Map<string, SkillCatalogPort>();
    await prepareMachineSkills(catalogs, {
      connector: machine.connector,
      machineName: 'gpu',
      root: MACHINE_ROOT,
      toolAllowlist: ['read'],
      skillDirectories: [],
    });
    expect(catalogs.size).toBe(0);
    expect(machine.calls).toEqual([]);
  });

  it('reads nothing when the root is not a Machine locator at all', async () => {
    const machine = fakeConnector();
    const catalogs = new Map<string, SkillCatalogPort>();
    await prepareMachineSkills(catalogs, {
      connector: machine.connector,
      machineName: 'devl',
      root: '/srv/app',
      toolAllowlist: ['read'],
      skillDirectories: [],
    });
    expect(catalogs.size).toBe(0);
    expect(machine.calls).toEqual([]);
  });

  it('keeps one catalog per root and drops the oldest past the limit', async () => {
    const machine = fakeConnector({
      answer: () => Promise.reject(new Error('unreachable')),
    });
    const catalogs = new Map<string, SkillCatalogPort>();
    const roots = Array.from(
      { length: 9 },
      (_unused, index) => `machine://devl/srv/app${index}`,
    );
    for (const root of roots) {
      await prepareMachineSkills(catalogs, {
        connector: machine.connector,
        machineName: 'devl',
        root,
        toolAllowlist: ['read'],
        skillDirectories: [],
      });
    }
    expect(catalogs.size).toBe(8);
    expect(catalogs.has(roots[0] ?? '')).toBe(false);
    expect(catalogs.has(roots[8] ?? '')).toBe(true);
    // Each catalog was read from the Machine the caller named, not from memory.
    expect(machine.calls.length).toBeGreaterThan(8);
    expect(machine.calls[0]?.name).toBe('devl');
    expect(machine.calls[0]?.method).toBe('fs.list');
  });

  it('replaces the snapshot of a root it already holds', async () => {
    const machine = fakeConnector({
      answer: () => Promise.reject(new Error('unreachable')),
    });
    const catalogs = new Map<string, SkillCatalogPort>();
    const params = {
      connector: machine.connector,
      machineName: 'devl',
      root: MACHINE_ROOT,
      toolAllowlist: ['read'],
      skillDirectories: [],
    };
    await prepareMachineSkills(catalogs, params);
    const first = catalogs.get(MACHINE_ROOT);
    const asked = machine.calls.length;
    await prepareMachineSkills(catalogs, params);
    expect(catalogs.size).toBe(1);
    expect(catalogs.get(MACHINE_ROOT)).not.toBe(first);
    expect(machine.calls.length).toBeGreaterThan(asked);
  });
});

describe('detachedBinding', () => {
  it('names no Machine when the detach removed none', () => {
    const binding = detachedBinding({
      chat: undefined,
      generation: 3,
      reason: 'root_missing',
    });
    expect(binding.chat).toBeUndefined();
    expect(Object.keys(binding)).toEqual(['chat']);
  });

  it('applies the reported generation and reason to the Chat copy', () => {
    const binding = detachedBinding({
      chat,
      generation: 3,
      reason: 'root_moved',
    });
    expect(binding.chat).toMatchObject({
      id: 'chat-1',
      workspaceRoot: null,
      workspaceExecutorId: null,
      workspaceGeneration: 4,
      workspaceDetachReason: 'root_moved',
    });
    expect(Object.keys(binding)).toEqual(['chat']);
  });

  it('keeps a removed Machine name on the detached state', () => {
    const binding = detachedBinding({
      chat: undefined,
      generation: 7,
      reason: 'executor_absent',
      removedMachine: 'devl',
    });
    expect(binding.machine).toEqual({
      name: 'devl',
      available: false,
      removed: true,
    });
  });
});

describe('machineAvailabilityNarration', () => {
  const available: MachineWorkspaceState = { name: 'devl', available: true };
  const unavailable: MachineWorkspaceState = {
    name: 'devl',
    available: false,
  };

  it('stays silent without a Machine binding', () => {
    expect(
      machineAvailabilityNarration({
        runId: RUN_ID,
        machine: undefined,
        toldAvailable: null,
      }),
    ).toBeUndefined();
  });

  it('leaves a removed Machine to the detach notice', () => {
    expect(
      machineAvailabilityNarration({
        runId: RUN_ID,
        machine: { ...unavailable, removed: true },
        toldAvailable: true,
      }),
    ).toBeUndefined();
  });

  it('says nothing when the Chat was already told this availability', () => {
    expect(
      machineAvailabilityNarration({
        runId: RUN_ID,
        machine: unavailable,
        toldAvailable: false,
      }),
    ).toBeUndefined();
  });

  it('narrates a loss of availability the Chat was not told about', () => {
    const narration = machineAvailabilityNarration({
      runId: RUN_ID,
      machine: unavailable,
      toldAvailable: true,
    });
    expect(narration?.available).toBe(false);
    expect(narration?.part).toMatchObject({
      data: {
        producer: 'workspace',
        form: 'notice',
        runId: RUN_ID,
        payload: { machine: 'devl' },
      },
    });
    expect(narration?.part.data.text).toContain('devl');
  });

  it('narrates a recovery, with the text the loss did not use', () => {
    const recovered = machineAvailabilityNarration({
      runId: RUN_ID,
      machine: available,
      toldAvailable: null,
    });
    const lost = machineAvailabilityNarration({
      runId: RUN_ID,
      machine: unavailable,
      toldAvailable: null,
    });
    expect(recovered?.available).toBe(true);
    expect(recovered?.part.data.text).toContain('devl');
    expect(recovered?.part.data.text).not.toBe(lost?.part.data.text);
  });
});

describe('machineInstructionAvailability', () => {
  it('is false without a connector, without Machines, or without read', () => {
    expect(
      machineInstructionAvailability({
        connector: undefined,
        toolAllowlist: ['read'],
      }),
    ).toBe(false);
    expect(
      machineInstructionAvailability({
        connector: { enabled: () => false },
        toolAllowlist: ['read'],
      }),
    ).toBe(false);
    expect(
      machineInstructionAvailability({
        connector: { enabled: () => true },
        toolAllowlist: ['enter_workspace'],
      }),
    ).toBe(false);
  });

  it('is true with a configured Machine and read allowed', () => {
    expect(
      machineInstructionAvailability({
        connector: { enabled: () => true },
        toolAllowlist: ['read', 'enter_workspace'],
      }),
    ).toBe(true);
  });
});

describe('machineInstructionWorld', () => {
  const identity: MachineAttemptIdentity = {
    runId: RUN_ID,
    deliverySequence: 4,
  };
  /** A page reader stands in for the audited `read` every world shares. */
  const readPage: ReadPage = () =>
    Promise.resolve({ status: 'success', content: 'page' });

  /** A real connector over the in-process daemon peer the world talks to. */
  function machineConnector(peer: ProtocolPeer) {
    return new MachineConnector({
      machines: {
        ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
        hosts: { devl: { destination: 'box' } },
      },
      hubVersion: '9.9.9',
      transportFactory: peer.factory,
    });
  }

  it('is absent without the gate or without a connector', () => {
    const peer = createProtocolPeer({ roots: ['/srv'] });
    const connector = machineConnector(peer);
    expect(
      machineInstructionWorld({
        enabled: false,
        connector,
        readPage,
        identity,
      }),
    ).toBeUndefined();
    expect(
      machineInstructionWorld({
        enabled: true,
        connector: undefined,
        readPage,
        identity,
      }),
    ).toBeUndefined();
  });

  it('probes the Machine under the attempt envelope', async () => {
    const peer = createProtocolPeer({
      roots: ['/srv'],
      answers: { 'roots.list': { value: { roots: ['/srv'] } } },
    });
    const world = machineInstructionWorld({
      enabled: true,
      connector: machineConnector(peer),
      readPage,
      identity,
    });
    expect(world?.readPage).toBe(readPage);
    const scope = await world?.probe({ name: 'devl', path: '/srv/notes.md' });
    expect(scope?.root).toBe('/srv');
    const session = await peer.session(0);
    expect(session.calls[0]).toEqual({
      method: 'roots.list',
      params: {
        envelope: {
          runId: RUN_ID,
          deliverySeq: 4,
          budgetMs: MACHINE_PREPARATION_BUDGET_MS,
        },
      },
    });
  });
});
