import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  type FsListEntry,
  type FsListResult,
  type FsReadResult,
  type FsStatResult,
  type JsonRpcNotification,
  type JsonValue,
  type McpServerEntry,
  type RootsListResult,
} from '@workspace/machine-protocol';
import {
  DIRECTORY_TRAVERSAL_BUDGET,
  readResolvedFile,
} from '@workspace/native-file-tools';
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import {
  bootWorkerHarness,
  createUser,
  seedAndDispatchRun,
  type WorkerHarness,
} from './worker-harness';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { isContextItemPart } from '../chats/context-item';
import { type MachinesConfig } from '../instance-config/machines-config';
import { type MachineTransportFactory } from '../machines/machine-transport';
import {
  createProtocolPeer,
  type PeerCall,
  type PeerSession,
  type ProtocolPeer,
} from '../testing/machine-protocol-peer';
import { waitFor } from '../testing/support';
import { type ScriptedBehavior } from './scripted-model-client';
import { type DeclarationRecord } from './scripted-model-records';
import { SystemPromptReceiptsRepository } from './system-prompt-receipts.repository';

/**
 * The Machine Workspace slice end to end: the real worker graph, the real model
 * loop, and a Machine whose filesystem is a temporary directory reached over
 * the in-process protocol peer. What is proven here is what no unit test can:
 * that the entry, the relative paths after it, the instruction chain, the skill
 * sources, the Workspace MCP servers, the availability narration, the detach,
 * and the owner isolation of a Machine-bound Chat are wired to each other
 * (remote-machines spec "Workspace entry accepts Machine locators", "Machine
 * instruction files are discovered within the containing root", "Machine
 * Workspace skills come from the Machine", "Workspace MCP servers of a Machine
 * Workspace run from the Machine", "An unreachable Machine does not detach its
 * Workspace", "Machine-resolved secrets are redacted on the hub", "Hub-held
 * Chat state stays owner-isolated on shared Machines").
 *
 * The peer stands in for the daemon's own work: it answers `roots.list`,
 * `fs.stat`, `fs.list`, and `fs.read` from the temporary directory using the
 * same `readResolvedFile` reader the daemon uses, resolves `mcp.servers` from
 * the Workspace's `.mcp.json`, and relays the JSON-RPC traffic of the scripted
 * server the hub opens. Framing, streams, the handshake, and heartbeats are the
 * peer's real wire, so everything above the transport is production code.
 *
 * The `devl` Machine is dropped from the shared configuration by the last test,
 * which is why the tests that need it come first.
 */
describe('Machine Workspaces through the durable worker', () => {
  let harness: WorkerHarness;
  let owner: string;
  let other: string;
  /** The directory the `devl` Machine's registered root lives in. */
  let machineHome: string;
  /** The registered root `devl` serves. */
  let shop: string;
  /** A second registered root, holding the owners' Workspaces. */
  let ownersRoot: string;
  /** A second Machine's registered root, so one Machine can be offline alone. */
  let gpuHome: string;
  let gpuRoot: string;
  let machines: MachinesConfig;
  let devl: FakeMachine;
  let gpu: FakeMachine;
  const allowedTools = [
    'read',
    'enter_workspace',
    'exit_workspace',
    'mcp__repo__*',
  ];

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL)
      throw new Error('Integration database was not provisioned.');
    machineHome = await realpath(
      await mkdtemp(join(tmpdir(), 'machine-home-')),
    );
    shop = join(machineHome, 'shop');
    ownersRoot = join(machineHome, 'owners');
    await mkdir(shop, { recursive: true });
    await mkdir(ownersRoot, { recursive: true });
    gpuHome = await realpath(await mkdtemp(join(tmpdir(), 'machine-gpu-')));
    gpuRoot = join(gpuHome, 'srv');
    await mkdir(gpuRoot, { recursive: true });
    // Two roots registered on the box: one Workspace to walk instruction
    // chains in, one holding the two owners' Workspaces.
    devl = createFakeMachine({ roots: [shop, ownersRoot] });
    gpu = createFakeMachine({ roots: [gpuRoot] });
    machines = {
      ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
      hosts: {
        devl: { destination: 'box' },
        gpu: { destination: 'me@gpu.lan:2222' },
      },
    };
    harness = await bootWorkerHarness({
      // No local native executor anywhere in this file: every Machine
      // operation below must work on a worker that has none, which is what the
      // spec requires and what a Machine-only worker looks like.
      allowedTools,
      machines,
      machineTransportFactory: createMachineFactory({ devl, gpu }),
      // An MCP tool needs its own exact permission group; the server's name is
      // scripted by the fake Machine, so the id is known here.
      toolPermissions: { mcp__repo__deploy: { allow: true } },
    });
    owner = await createUser(harness.db, 'machine-owner');
    other = await createUser(harness.db, 'machine-other');
  });

  afterAll(async () => {
    if (harness) await harness.close();
    await rm(machineHome, { recursive: true, force: true });
    await rm(gpuHome, { recursive: true, force: true });
  });

  it('binds a Machine root on entry and resolves a later relative read on it', async () => {
    const chatId = await createChat(owner);
    await writeFile(join(shop, 'README.md'), 'machine readme\n');

    const entered = await runScript({
      userId: owner,
      chatId,
      tag: 'machine-enter',
      calls: [
        {
          id: 'enter',
          name: 'enter_workspace',
          input: { path: `machine://devl${shop}` },
        },
      ],
    });

    const enterOutput = await completedOutput(entered.runId, owner, 'enter');
    expect(enterOutput).toMatchObject({
      status: 'success',
      root: `machine://devl${shop}`,
      state: 'bound',
    });
    // The entry discloses the Machine's own authority, not a hub user's.
    expect(enterOutput['authority']).toContain("Machine's own OS user");
    expect(await chatRow(chatId, owner)).toMatchObject({
      workspaceRoot: `machine://devl${shop}`,
      workspaceExecutorId: 'machine:devl',
    });

    // A later Run in the same Chat: the relative path resolves on the Machine
    // through the binding the Chat already holds, with no new entry.
    const read = await runScript({
      userId: owner,
      chatId,
      tag: 'machine-read',
      calls: [{ id: 'readme', name: 'read', input: { path: 'README.md' } }],
    });

    expect(await completedOutput(read.runId, owner, 'readme')).toMatchObject({
      status: 'success',
      kind: 'file',
      path: `machine://devl${shop}/README.md`,
      // Exactly what a local read of those bytes returns, trailing newline
      // included.
      content: '1: machine readme\n',
    });
    expect(devl.callsForPath(`${shop}/README.md`)).not.toHaveLength(0);

    // The turn after the entry narrates the Machine Workspace, its authority,
    // and the shared OS user — not the local Workspace statement.
    const snapshot = (await workspaceItems(chatId, read.runId, owner)).find(
      (item) => item['form'] === 'snapshot',
    );
    expect(snapshot?.['text']).toContain(`machine://devl${shop}`);
    expect(snapshot?.['text']).toContain('on Machine `devl`');
    expect(snapshot?.['text']).toContain('no isolation between them');
  });

  it('loads a Machine instruction file from the registered root and never above it', async () => {
    const chatId = await createChat(owner);
    // The ancestor sits above the registered root: the chain is rooted at the
    // registered root that contains the target, so it is never read.
    const ancestor = join(machineHome, 'AGENTS.md');
    await writeFile(ancestor, 'above-the-root rules: never read\n');
    await writeFile(join(shop, 'AGENTS.md'), 'shop rules: run the suite\n');

    const entered = await runScript({
      userId: owner,
      chatId,
      tag: 'machine-instructions',
      calls: [
        {
          id: 'enter-instr',
          name: 'enter_workspace',
          input: { path: `machine://devl${shop}` },
        },
      ],
    });

    expect(entered.promptText).toContain(
      `<file path="machine://devl${shop}/AGENTS.md">`,
    );
    expect(entered.promptText).toContain('shop rules: run the suite');
    expect(entered.promptText).not.toContain('above-the-root rules');
    // Not merely absent from the chain: never asked of the Machine.
    expect(devl.callsForPath(ancestor)).toHaveLength(0);

    await rm(ancestor, { force: true });
  });

  it('offers a Machine Workspace skill and reads its files from the Machine', async () => {
    const chatId = await createChat(owner);
    const skillDirectory = join(shop, '.agents', 'skills', 'deploy');
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(
      join(skillDirectory, 'SKILL.md'),
      '---\nname: deploy\ndescription: Ship the shop from the Machine.\n---\n\n# Machine deploy skill\n',
    );

    await runScript({
      userId: owner,
      chatId,
      tag: 'machine-skill-enter',
      calls: [
        {
          id: 'enter-skill',
          name: 'enter_workspace',
          input: { path: `machine://devl${shop}` },
        },
      ],
    });

    // The Run after the binding: the skill sources are the Machine's, so the
    // package is offered in the prompt and its document is read through the
    // Machine.
    const read = await runScript({
      userId: owner,
      chatId,
      tag: 'machine-skill-read',
      calls: [{ id: 'skill', name: 'read', input: { path: 'skill://deploy' } }],
    });

    const skillOutput = await completedOutput(read.runId, owner, 'skill');
    expect(skillOutput).toMatchObject({
      status: 'success',
      skillDirectory: `machine://devl${skillDirectory}`,
    });
    expect(skillOutput['content']).toContain('# Machine deploy skill');
    expect(devl.callsForPath(`${skillDirectory}/SKILL.md`)).not.toHaveLength(0);

    const systemPrompt = await systemPromptOf(read.runId, owner);
    expect(systemPrompt).toContain('deploy');
    expect(systemPrompt).toContain('Ship the shop from the Machine.');

    await rm(join(shop, '.agents'), { recursive: true, force: true });
  });

  it('keeps the binding while the Machine is offline, and narrates each transition once', async () => {
    const chatId = await createChat(owner);
    await runScript({
      userId: owner,
      chatId,
      tag: 'machine-availability-enter',
      calls: [
        {
          id: 'enter-availability',
          name: 'enter_workspace',
          input: { path: `machine://devl${shop}` },
        },
      ],
    });
    await writeFile(join(gpuRoot, 'GPU.md'), 'gpu readme\n');

    devl.disconnect();
    const offlineCalls = [
      { id: 'relative', name: 'read', input: { path: 'README.md' } },
      {
        id: 'other-machine',
        name: 'read',
        input: { path: `machine://gpu${gpuRoot}/GPU.md` },
      },
    ];
    const run1 = await runScript({
      userId: owner,
      chatId,
      tag: 'machine-offline-1',
      calls: offlineCalls,
    });

    // Only operations addressing the offline Machine fail; another Machine and
    // the Chat itself keep working, and the binding is not detached.
    expect(await completedOutput(run1.runId, owner, 'relative')).toMatchObject({
      status: 'error',
      type: 'machine_unavailable',
    });
    expect(
      await completedOutput(run1.runId, owner, 'other-machine'),
    ).toMatchObject({
      status: 'success',
      path: `machine://gpu${gpuRoot}/GPU.md`,
    });
    expect(await chatRow(chatId, owner)).toMatchObject({
      workspaceRoot: `machine://devl${shop}`,
      workspaceExecutorId: 'machine:devl',
      workspaceDetachReason: null,
      workspaceToldAvailable: false,
    });
    const notices = (await workspaceItems(chatId, run1.runId, owner)).filter(
      (item) => item['form'] === 'notice',
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.['text']).toContain(
      'Machine `devl` is unreachable, so this Workspace is offline for now.',
    );

    // A second Run while it stays offline: the transition was already told.
    const run2 = await runScript({
      userId: owner,
      chatId,
      tag: 'machine-offline-2',
      calls: offlineCalls,
    });
    expect(
      (await workspaceItems(chatId, run2.runId, owner)).filter(
        (item) => item['form'] === 'notice',
      ),
    ).toHaveLength(0);
    expect(await chatRow(chatId, owner)).toMatchObject({
      workspaceRoot: `machine://devl${shop}`,
      workspaceToldAvailable: false,
    });

    // Recovery: one further transition, and relative paths resolve again with
    // no new entry.
    devl.reconnect();
    const run3 = await runScript({
      userId: owner,
      chatId,
      tag: 'machine-recovered',
      calls: [{ id: 'recovered', name: 'read', input: { path: 'README.md' } }],
    });
    expect(await completedOutput(run3.runId, owner, 'recovered')).toMatchObject(
      {
        status: 'success',
        path: `machine://devl${shop}/README.md`,
      },
    );
    const recovered = (await workspaceItems(chatId, run3.runId, owner)).filter(
      (item) => item['form'] === 'notice',
    );
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.['text']).toContain(
      'Machine `devl` is reachable again',
    );
    expect(await chatRow(chatId, owner)).toMatchObject({
      workspaceRoot: `machine://devl${shop}`,
      workspaceToldAvailable: true,
    });

    // A Run while it stays reachable tells nothing further.
    const run4 = await runScript({
      userId: owner,
      chatId,
      tag: 'machine-steady',
      calls: [{ id: 'steady', name: 'read', input: { path: 'README.md' } }],
    });
    expect(
      (await workspaceItems(chatId, run4.runId, owner)).filter(
        (item) => item['form'] === 'notice',
      ),
    ).toHaveLength(0);

    // Exit succeeds while the bound Machine is offline, without waiting for
    // it: the Machine is never asked.
    devl.disconnect();
    const requestsBeforeExit = devl.calls().length;
    const run5 = await runScript({
      userId: owner,
      chatId,
      tag: 'machine-exit-offline',
      calls: [{ id: 'exit', name: 'exit_workspace', input: {} }],
    });
    expect(await completedOutput(run5.runId, owner, 'exit')).toMatchObject({
      status: 'success',
      state: 'exited',
      previousRoot: `machine://devl${shop}`,
    });
    expect(await chatRow(chatId, owner)).toMatchObject({
      workspaceRoot: null,
      workspaceExecutorId: null,
    });
    expect(devl.calls()).toHaveLength(requestsBeforeExit);
    // The outage is over for the tests that follow.
    devl.reconnect();
  });

  it('serves one Machine to two owners without sharing their hub-held state', async () => {
    const ownChat = await createChat(owner);
    const otherChat = await createChat(other);
    const ownRoot = join(ownersRoot, 'owner-a');
    const otherRoot = join(ownersRoot, 'owner-b');
    await mkdir(ownRoot, { recursive: true });
    await mkdir(otherRoot, { recursive: true });
    await writeWorkspaceServer(ownRoot, 'A');
    await writeWorkspaceServer(otherRoot, 'B');

    const scriptFor = (root: string, tag: string) => [
      {
        id: `enter-${tag}`,
        name: 'enter_workspace',
        input: { path: `machine://devl${root}` },
      },
      { id: `call-${tag}`, name: 'mcp__repo__deploy', input: {} },
    ];
    const own = await runScript({
      userId: owner,
      chatId: ownChat,
      tag: 'machine-isolation-a',
      calls: scriptFor(ownRoot, 'A'),
    });
    const others = await runScript({
      userId: other,
      chatId: otherChat,
      tag: 'machine-isolation-b',
      calls: scriptFor(otherRoot, 'B'),
    });

    // Bindings: each Chat holds its own root and executor, and the other
    // owner's tenant read cannot see it.
    expect(await chatRow(ownChat, owner)).toMatchObject({
      workspaceRoot: `machine://devl${ownRoot}`,
      workspaceExecutorId: 'machine:devl',
    });
    expect(await chatRow(otherChat, other)).toMatchObject({
      workspaceRoot: `machine://devl${otherRoot}`,
      workspaceExecutorId: 'machine:devl',
    });
    expect(await chatRow(ownChat, other)).toBeUndefined();
    expect(await chatRow(otherChat, owner)).toBeUndefined();

    // Declarations: the same server name and tool id, each Run offered the
    // declaration of its own Workspace, with the value the Machine resolved
    // redacted out of it.
    const ownDeclaration = declarationOf(
      own.declaredTools,
      'mcp__repo__deploy',
    );
    const otherDeclaration = declarationOf(
      others.declaredTools,
      'mcp__repo__deploy',
    );
    expect(ownDeclaration).toContain('Deploy A');
    expect(ownDeclaration).toContain('[REDACTED]');
    expect(ownDeclaration).not.toContain('token-A');
    expect(ownDeclaration).not.toContain('Deploy B');
    expect(otherDeclaration).toContain('Deploy B');
    expect(otherDeclaration).not.toContain('Deploy A');

    // The hub sent the Machine a name and nothing that names a process: no
    // command, no URL, no header.
    const opened = devl.calls().filter((call) => call.method === 'mcp.open');
    expect(opened).not.toHaveLength(0);
    expect(Object.keys(opened[0]?.params ?? {})).toEqual([
      'envelope',
      'root',
      'server',
    ]);

    // Results: each call ran against the server of its own binding, and the
    // Machine-resolved value stayed redacted.
    const ownResult = JSON.stringify(
      await completedOutput(own.runId, owner, 'call-A'),
    );
    const otherResult = JSON.stringify(
      await completedOutput(others.runId, other, 'call-B'),
    );
    expect(ownResult).toContain('deployed A');
    expect(ownResult).toContain('[REDACTED]');
    expect(ownResult).not.toContain('token-A');
    expect(ownResult).not.toContain('deployed B');
    expect(otherResult).toContain('deployed B');
    expect(otherResult).not.toContain('deployed A');
  });

  it('lists the registered roots as Machine locators and discloses no route', async () => {
    const chatId = await createChat(owner);
    const listed = await runScript({
      userId: owner,
      chatId,
      tag: 'machine-roots',
      calls: [{ id: 'list', name: 'read', input: { path: 'machine://devl' } }],
    });

    const output = await completedOutput(listed.runId, owner, 'list');
    expect(output).toMatchObject({
      status: 'success',
      kind: 'directory',
      path: 'machine://devl',
    });
    expect(output['content']).toContain(`machine://devl${shop}`);
    const text = JSON.stringify(output);
    // No SSH destination, jump host, identity, or pinned host-key file appears
    // in anything the model sees.
    expect(text).not.toContain('box');
    expect(text).not.toContain('gpu.lan');
    expect(text).not.toContain('/etc/llame/machine_known_hosts');
  });

  it('detaches a Workspace whose Machine the operator removed', async () => {
    const chatId = await createChat(owner);
    await runScript({
      userId: owner,
      chatId,
      tag: 'machine-removed-enter',
      calls: [
        {
          id: 'enter-removed',
          name: 'enter_workspace',
          input: { path: `machine://devl${shop}` },
        },
      ],
    });

    // The operator drops the Machine from the configuration. The next Run
    // detaches the binding as `executor_absent` and names the Machine.
    delete machines.hosts['devl'];
    const run = await runScript({
      userId: owner,
      chatId,
      tag: 'machine-removed',
      calls: [
        {
          id: 'gone',
          name: 'read',
          input: { path: `machine://devl${shop}/README.md` },
        },
      ],
    });

    // The detach reason is the notice's: the dispatch transaction that
    // persisted the narration below cleared it in the same write
    // (`workspace-entry` "Detach reason clears after completed narration"), so
    // the removed Machine is named by the notice, not by the row.
    expect(await chatRow(chatId, owner)).toMatchObject({
      workspaceRoot: null,
      workspaceExecutorId: null,
      workspaceDetachReason: null,
    });
    const detach = (await workspaceItems(chatId, run.runId, owner)).find(
      (item) => item['form'] === 'notice',
    );
    expect(detach?.['text']).toContain(
      'Machine `devl` is no longer configured on this instance',
    );
    // The Machine's name is no longer an addressable scheme target.
    expect(await completedOutput(run.runId, owner, 'gone')).toMatchObject({
      status: 'error',
      type: 'machine_not_found',
    });
  });

  // ---- Fixtures ----------------------------------------------------------

  type ScriptedCall = {
    readonly id: string;
    readonly name: string;
    readonly input: UnknownRecord;
  };

  type ScriptedRun = {
    readonly runId: string;
    readonly chatId: string;
    /** Every provider prompt the Run's turns served, joined for matching. */
    readonly promptText: string;
    /** Every declaration the Run's requests carried. */
    readonly declaredTools: ReadonlyArray<DeclarationRecord>;
  };

  /**
   * Register one scripted turn, dispatch it into the Chat, wait for the Run to
   * settle, and return what its requests carried. Declarations and prompts ride
   * beside the provider prompt rather than inside it, so the recorded window is
   * read here, while nothing else can be running: the integration project runs
   * its files sequentially.
   */
  async function runScript(input: {
    userId: string;
    chatId: string;
    tag: string;
    calls: ReadonlyArray<ScriptedCall>;
    finalText?: string;
  }): Promise<ScriptedRun> {
    const modelId = `${input.tag}-${randomUUID()}`;
    const behavior: Extract<ScriptedBehavior, { kind: 'tool-script' }> = {
      kind: 'tool-script',
      finalText: input.finalText ?? 'Done.',
      calls: input.calls,
      // These Runs prove what a Machine Workspace offers, and the offered
      // skills reach a model only through the skill-referencing system prompt.
      referencesSkills: true,
    };
    harness.models.register(modelId, behavior);
    const promptsFrom = harness.models.prompts.length;
    const declarationsFrom = harness.models.declarations.length;
    const seeded = await seedAndDispatchRun(harness, {
      userId: input.userId,
      modelId,
      chatId: input.chatId,
    });
    await terminal(seeded.runId, input.userId);
    return {
      runId: seeded.runId,
      chatId: input.chatId,
      promptText: harness.models.prompts
        .slice(promptsFrom)
        .map(promptTextOf)
        .join('\n'),
      declaredTools: harness.models.declarations
        .slice(declarationsFrom)
        .flatMap((entry) => entry.tools),
    };
  }

  /**
   * A titled Chat for one owner, created the way the accepting API does — the
   * same shape `seedRun` writes when it opens a Chat itself, so the pre-set id
   * below names a row that exists under that owner's policy.
   */
  async function createChat(userId: string): Promise<string> {
    const chatId = randomUUID();
    await harness.tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: userId,
        title: 'Machine workspace chat',
      }),
    );
    return chatId;
  }

  async function terminal(runId: string, userId: string) {
    return waitFor(
      async () => {
        const run = await harness.tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).findById(runId, userId),
        );
        return run &&
          ['completed', 'failed', 'cancelled', 'expired'].includes(run.status)
          ? run
          : undefined;
      },
      30_000,
      'the Machine Run to settle',
    );
  }

  /** One tool call's `output`, read from the Run's own events. */
  async function completedOutput(
    runId: string,
    userId: string,
    toolCallId: string,
  ): Promise<UnknownRecord> {
    const events = await harness.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, userId),
    );
    const completed = events.find(
      (event) =>
        event.eventType === 'tool.completed' &&
        isRecord(event.payload) &&
        event.payload['toolCallId'] === toolCallId,
    );
    const output = isRecord(completed?.payload)
      ? completed.payload['output']
      : undefined;
    if (!isRecord(output))
      throw new Error(
        `The Run recorded no completed output for ${toolCallId}.`,
      );
    return output;
  }

  async function chatRow(chatId: string, userId: string) {
    return harness.tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).findById(chatId, userId),
    );
  }

  /** The `workspace` context items one Run persisted, in stored order. */
  async function workspaceItems(
    chatId: string,
    runId: string,
    userId: string,
  ): Promise<ReadonlyArray<UnknownRecord>> {
    const messages = await harness.tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    return messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        isContextItemPart(part) &&
        isRecord(part.data) &&
        part.data['runId'] === runId &&
        part.data['producer'] === 'workspace'
          ? [part.data]
          : [],
      ),
    );
  }

  /** The system prompt one Run's attempt published with its receipt. */
  async function systemPromptOf(
    runId: string,
    userId: string,
  ): Promise<string> {
    const receipts = await harness.tenantDb.runAs(userId, (tx) =>
      new SystemPromptReceiptsRepository(tx).findByOwnedRun(runId, userId),
    );
    return receipts.map((receipt) => receipt.systemPrompt).join('\n');
  }

  function declarationOf(
    declared: ReadonlyArray<DeclarationRecord>,
    toolId: string,
  ): string {
    const entry = declared.find((candidate) => candidate.toolId === toolId);
    if (entry === undefined)
      throw new Error(`The Run never declared ${toolId}.`);
    return entry.description;
  }
});

/** One server a Workspace's `.mcp.json` declares, as this fake Machine resolved it. */
type WorkspaceServerDeclaration = {
  readonly name: string;
  readonly transport: 'stdio' | 'http';
  /** The value the Machine's own environment supplied for `{env:REPO_TAG}`. */
  readonly tag: string | undefined;
  /** The protected value it resolved for `{env:REPO_TOKEN}`. */
  readonly token: string | undefined;
};

type FakeMachine = {
  readonly peer: ProtocolPeer;
  /**
   * Make every later link fail, and end the sessions already open: a hub that
   * holds a ready session keeps answering on it, so an outage is a lost link
   * as well as a refused one.
   */
  disconnect(): void;
  /** Let links open again (the Machine came back). */
  reconnect(): void;
  /** Every request the hub sent it, across sessions, in arrival order. */
  calls(): ReadonlyArray<PeerCall>;
  /** Every request whose `params.path` is exactly `path`. */
  callsForPath(path: string): ReadonlyArray<PeerCall>;
};

type JsonRpcCall = {
  readonly id: JsonValue;
  readonly method: string;
  readonly params?: JsonValue;
};

/**
 * One Machine: the in-process wire, with a temporary directory as its
 * filesystem and its own `.mcp.json`-declared servers. The roots are the
 * registered roots this Machine serves; `setDown` makes every later connection
 * fail the way ssh reports an unreachable host.
 */
function createFakeMachine(input: {
  roots: ReadonlyArray<string>;
}): FakeMachine {
  const registered = [...input.roots];
  const state = { down: false };
  const peer = createProtocolPeer({
    roots: registered,
    openFailure: () =>
      state.down
        ? 'ssh: connect to host box port 22: Connection refused'
        : undefined,
    // A started server's channel outlives its `mcp.open` answer: the daemon
    // returns the definition's protected values and then relays the server's
    // own JSON-RPC on the same stream, so the peer holds it open.
    answers: { 'mcp.open': { hold: true } },
    answer: (call) => {
      if (call.method === 'mcp.open') holdOpenChannel(peer, call);
      return answerMachineRequest(registered, call);
    },
    onNotification: (method, notification) => {
      if (method === 'mcp.open') relayMcpTraffic(peer, notification);
    },
  });
  return {
    peer,
    disconnect: () => {
      state.down = true;
      for (const session of peer.sessions) session.drop();
    },
    reconnect: () => {
      state.down = false;
    },
    calls: () => peer.sessions.flatMap((session) => [...session.calls]),
    callsForPath: (path) =>
      peer.sessions.flatMap((session) =>
        session.calls.filter(
          (call) => isRecord(call.params) && call.params['path'] === path,
        ),
      ),
  };
}

/** The injected transport factory, routing each link to its Machine's peer. */
function createMachineFactory(
  byName: Readonly<Record<string, FakeMachine>>,
): MachineTransportFactory {
  return {
    open: (request) => {
      const machine = byName[request.name];
      if (machine === undefined) {
        throw new Error(`No fake Machine is named ${request.name}.`);
      }
      return machine.peer.factory.open(request);
    },
  };
}

type MachineAnswer =
  | { readonly value: JsonValue; readonly error?: undefined }
  | { readonly error: 'path_not_registered' | 'internal' };

/** One request as this Machine answers it; `undefined` falls back to a refusal. */
function answerMachineRequest(
  roots: ReadonlyArray<string>,
  call: PeerCall,
): MachineAnswer | Promise<MachineAnswer> | undefined {
  switch (call.method) {
    case 'roots.list':
      return { value: { roots: [...roots] } satisfies RootsListResult };
    case 'fs.stat':
    case 'fs.list':
    case 'fs.read':
      return answerFileRequest(roots, call);
    case 'mcp.servers':
      return { value: { servers: resolvedServers(call) } };
    default:
      // `mcp.open` is held open by the peer's `answers`, not answered here.
      return undefined;
  }
}

/**
 * Answer one `mcp.open` with the protected values of the definition the hub
 * asked to start, and keep the stream open for the server's own traffic. The
 * answer callback runs before the peer records the hold, so the release is
 * deferred one microtask.
 */
function holdOpenChannel(peer: ProtocolPeer, call: PeerCall): void {
  const session = peer.sessions.at(-1);
  queueMicrotask(() =>
    session?.release('mcp.open', { protectedValues: openedValues(call) }, true),
  );
}

async function answerFileRequest(
  roots: ReadonlyArray<string>,
  call: PeerCall,
): Promise<MachineAnswer> {
  const path = paramsOf(call, 'path');
  if (!isString(path)) return { error: 'path_not_registered' };
  const guarded = await guardPath(roots, path);
  if (guarded === undefined) return { error: 'path_not_registered' };
  if (call.method === 'fs.stat') {
    return {
      value: {
        kind: guarded.kind,
        isLink: false,
        ...(guarded.kind !== 'missing' && {
          realPath: guarded.canonical,
          size: guarded.size,
        }),
      } satisfies FsStatResult,
    };
  }
  if (call.method === 'fs.list') {
    if (guarded.kind !== 'directory') {
      return {
        value: {
          status: 'error',
          type: 'not_regular_file',
          message: 'The target is not a directory.',
        } satisfies FsListResult,
      };
    }
    const entries = await directoryEntries(guarded.path);
    return {
      value: {
        entries: entries.slice(0, DIRECTORY_TRAVERSAL_BUDGET),
        totalCount: entries.length,
        truncated: entries.length > DIRECTORY_TRAVERSAL_BUDGET,
      } satisfies FsListResult,
    };
  }
  // The same reader the daemon reads with, so a Machine read returns exactly
  // what a local read of those bytes returns.
  const selector = readSelector(paramsOf(call, 'selector', 'options'));
  const result = await readResolvedFile(guarded.canonical, {
    displayPath: `${displayPrefixOf(call)}${guarded.path}`,
    followSymlinks: true,
    linkTargets: false,
    ...selector,
  });
  return {
    value:
      result.status === 'success' &&
      result.kind === 'file' &&
      guarded.canonical !== guarded.path
        ? {
            ...result,
            realPath: `${displayPrefixOf(call)}${guarded.canonical}`,
          }
        : (result satisfies FsReadResult),
  };
}

type GuardedPath = {
  readonly path: string;
  readonly canonical: string;
  readonly kind: 'file' | 'directory' | 'other' | 'missing';
  readonly size?: number;
};

/**
 * One path as the daemon's root guard sees it: inside a registered root
 * lexically, before any probe, then classified from what it resolves to. A
 * path outside every root answers the fixed refusal, whether or not anything
 * exists there.
 */
async function guardPath(
  roots: ReadonlyArray<string>,
  path: string,
): Promise<GuardedPath | undefined> {
  if (!path.startsWith('/')) return undefined;
  const lexical = resolve(path);
  if (!roots.some((root) => isInside(root, lexical))) return undefined;
  const canonical = await realpath(lexical).catch(() => lexical);
  if (!roots.some((root) => isInside(root, canonical))) return undefined;
  const entry = await stat(lexical).catch(() => undefined);
  if (entry === undefined) {
    return { path: lexical, canonical, kind: 'missing' };
  }
  return {
    path: lexical,
    canonical,
    kind: entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : 'other',
    size: entry.size,
  };
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** One directory's entries, in the order the daemon lists them. */
async function directoryEntries(path: string): Promise<Array<FsListEntry>> {
  const dirents = await readdir(path, { withFileTypes: true });
  const entries: Array<FsListEntry> = dirents.map((dirent) => ({
    name: dirent.name,
    kind: dirent.isSymbolicLink()
      ? 'link'
      : dirent.isDirectory()
        ? 'directory'
        : dirent.isFile()
          ? 'file'
          : 'other',
  }));
  return entries.sort((left, right) => {
    const leftDirectory = left.kind === 'directory' ? 0 : 1;
    const rightDirectory = right.kind === 'directory' ? 0 : 1;
    return leftDirectory === rightDirectory
      ? left.name.localeCompare(right.name)
      : leftDirectory - rightDirectory;
  });
}

/** The servers the Machine resolved for the root the hub asked about. */
function resolvedServers(call: PeerCall): ReadonlyArray<McpServerEntry> {
  const root = paramsOf(call, 'root');
  if (!isString(root)) return [];
  return readWorkspaceServers(root).map((server) => ({
    name: server.name,
    transport: server.transport,
    state: 'available' as const,
  }));
}

/** The protected values of the exact server the hub asked the Machine to open. */
function openedValues(call: PeerCall): ReadonlyArray<string> {
  const root = paramsOf(call, 'root');
  const server = paramsOf(call, 'server');
  if (!isString(root) || !isString(server)) return [];
  const declared = readWorkspaceServers(root).find(
    (candidate) => candidate.name === server,
  );
  return declared?.token === undefined ? [] : [declared.token];
}

/**
 * Read one Workspace's `.mcp.json` the way the Machine does: the names it
 * declares and the values the Machine's own environment resolved into it. The
 * hub never sees the file, and never sees the command.
 */
function readWorkspaceServers(
  root: string,
): ReadonlyArray<WorkspaceServerDeclaration> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
  } catch {
    return [];
  }
  if (!isRecord(raw) || !isRecord(raw['mcpServers'])) return [];
  return Object.entries(raw['mcpServers']).flatMap(([name, entry]) => {
    if (!isRecord(entry)) return [];
    const env = isRecord(entry['env']) ? entry['env'] : {};
    const tag = env['REPO_TAG'];
    const token = env['REPO_TOKEN'];
    return [
      {
        name,
        transport: entry['type'] === 'http' ? 'http' : 'stdio',
        tag: isString(tag) ? tag : undefined,
        token: isString(token) ? token : undefined,
      },
    ];
  });
}

/**
 * Relay one JSON-RPC message the hub sent on the server's channel, answered by
 * the server this Machine started for that root — exactly the shape a real
 * daemon relays, with the declaration and results carrying the values it
 * resolved, so the hub must redact them.
 */
function relayMcpTraffic(
  peer: ProtocolPeer,
  notification: JsonRpcNotification,
): void {
  if (notification.method !== 'mcp.message') return;
  const call = jsonRpcCall(
    isRecord(notification.params) ? notification.params['message'] : undefined,
  );
  const session = peer.sessions.at(-1);
  if (call === undefined || session === undefined) return;
  const answer = mcpServerAnswer(call, openedServer(session));
  if (answer === undefined) return;
  session.notify('mcp.open', 'mcp.message', { message: answer });
}

/** The server the hub most recently opened on this session, as the Machine resolved it. */
function openedServer(
  session: PeerSession,
): WorkspaceServerDeclaration | undefined {
  const opened = session.calls
    .filter((call) => call.method === 'mcp.open')
    .at(-1);
  const root = opened === undefined ? undefined : paramsOf(opened, 'root');
  const server = opened === undefined ? undefined : paramsOf(opened, 'server');
  if (!isString(root) || !isString(server)) return undefined;
  return readWorkspaceServers(root).find(
    (candidate) => candidate.name === server,
  );
}

/** One JSON-RPC answer of the scripted server, or none for a notification. */
function mcpServerAnswer(
  call: JsonRpcCall,
  server: WorkspaceServerDeclaration | undefined,
): JsonValue | undefined {
  if (server === undefined) return undefined;
  const tag = server.tag ?? 'unknown';
  const token = server.token ?? '';
  switch (call.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id: call.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'repo', version: '0.0.1' },
        },
      };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id: call.id,
        result: {
          tools: [
            {
              name: 'deploy',
              description: `Deploy ${tag} with ${token}.`,
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      };
    case 'tools/call':
      return {
        jsonrpc: '2.0',
        id: call.id,
        result: {
          content: [{ type: 'text', text: `deployed ${tag} using ${token}` }],
        },
      };
    default:
      return undefined;
  }
}

function jsonRpcCall(message: JsonValue | undefined): JsonRpcCall | undefined {
  if (!isRecord(message)) return undefined;
  const id = message['id'];
  const method = message['method'];
  if (!isString(method) || (!isString(id) && !isNumber(id))) return undefined;
  const params = message['params'];
  return params === undefined ? { id, method } : { id, method, params };
}

/**
 * One field of one request's params, or of a nested params object. Values are
 * untrusted JSON: only a scalar is returned, and anything else reads as absent.
 * `container` names the record the field lives in, when it is not `params`
 * itself (`paramsOf(call, 'displayPrefix', 'options')`).
 */
function paramsOf(
  call: PeerCall | undefined,
  key: string,
  container?: string,
): JsonValue | undefined {
  const params = call?.params;
  const source = container === undefined ? params : field(params, container);
  return field(source, key);
}

function field(
  value: JsonValue | undefined,
  key: string,
): JsonValue | undefined {
  if (!isRecord(value)) return undefined;
  const entry = value[key];
  return isString(entry) ||
    isNumber(entry) ||
    isBoolean(entry) ||
    entry === null ||
    Array.isArray(entry) ||
    isRecord(entry)
    ? entry
    : undefined;
}

/** A read selector as `readResolvedFile` takes it, or nothing at all. */
function readSelector(
  selector: JsonValue | undefined,
): { readonly selector: string } | undefined {
  return isString(selector) ? { selector } : undefined;
}

/** The `machine://<name>` display prefix the hub asked a read to report under. */
function displayPrefixOf(call: PeerCall | undefined): string {
  const prefix = paramsOf(call, 'displayPrefix', 'options');
  return isString(prefix) ? prefix : '';
}

/**
 * The text a provider prompt carried, message by message. The prompt is the
 * SDK's structured message list, so the bytes a model reads are its string
 * content and its text parts — JSON-serializing the structure would escape the
 * quotes the matching above asserts on.
 */
function promptTextOf(prompt: unknown): string {
  if (!Array.isArray(prompt)) return '';
  return prompt
    .flatMap((message) => {
      if (!isRecord(message)) return [];
      const content = message['content'];
      if (isString(content)) return [content];
      if (!Array.isArray(content)) return [];
      return content.flatMap((part) =>
        isRecord(part) && part['type'] === 'text' && isString(part['text'])
          ? [part['text']]
          : [],
      );
    })
    .join('\n');
}

/** One Workspace's `.mcp.json`: a server whose resolution carries its own tag. */
async function writeWorkspaceServer(root: string, tag: string): Promise<void> {
  await writeFile(
    join(root, '.mcp.json'),
    `${JSON.stringify(
      {
        mcpServers: {
          repo: {
            type: 'stdio',
            command: 'node',
            args: ['repo-server.js'],
            env: { REPO_TAG: tag, REPO_TOKEN: `token-${tag}` },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}
