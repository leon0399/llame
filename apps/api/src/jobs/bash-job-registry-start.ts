import { randomBytes } from 'node:crypto';
import {
  Code,
  ConnectError,
  type CallOptions,
  type Client,
} from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import {
  JobSchema,
  JobState,
  JobService,
  LostCause,
  MachineProtocolError,
  type CreateJobResponse,
  type Job,
} from '@workspace/machine-protocol';
import { ChatsRepository } from '../chats/chats-repository';
import { type ChatJob } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { mapMachineRefusal } from '../machines/machine-session-errors';
import type { MachineRequestOptions } from '../machines/machine-session';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import {
  machineProtocolFailureResult,
  machineUnknownResult,
} from '../tools/machine-call';
import { type BashInput, type BashMachineTarget } from '../tools/bash-target';
import { type ToolContext, type ToolResult } from '../tools/types';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { ChatJobsRepository } from './chat-jobs.repository';

type JobsClient = Client<typeof JobService>;

type JobsCallOptions = (options?: MachineRequestOptions) => CallOptions;

type MachineJobsSession = {
  client: JobsClient;
  instanceId: string;
  ended: Promise<unknown>;
  callOptions: JobsCallOptions;
};

type Connector = {
  jobsClient(machineName: string): Promise<MachineJobsSession>;
};

type BashJobStartDependencies = {
  tenantDb: TenantRunner;
  connector: Connector;
  config: InstanceConfigReader;
  context: ToolContext;
  machine: BashMachineTarget;
  input: BashInput;
  settleLost: (row: ChatJob, job: Job) => Promise<void>;
};

export type BashJobStart =
  | {
      kind: 'started';
      row: ChatJob;
      client: JobsClient;
      callOptions: JobsCallOptions;
      ended: Promise<unknown>;
      daemonJobId: string;
      startedAt: Date;
      lifetimeMs: number;
    }
  | { kind: 'failed'; result: ToolResult };

export async function startBashJob(
  deps: BashJobStartDependencies,
): Promise<BashJobStart> {
  const failure = validateStart(deps.context, deps.input);

  if (failure !== undefined) return { kind: 'failed', result: failure };

  return dispatchBashJob(deps);
}

function validateStart(
  context: ToolContext,
  input: BashInput,
): ToolResult | undefined {
  if (!context.runId || !context.attemptId || !context.toolCallId)
    return unavailable('The Run identity is unavailable.');

  if (input.unlimited === true && context.allowUnlimitedJobs !== true)
    return unavailable(
      'tools.jobs.allowUnlimited is false; unlimited jobs are not allowed.',
    );

  return undefined;
}

type CreateBoundBashJobInput = {
  deps: BashJobStartDependencies;
  binding: ChatJob;
  machineClient: MachineJobsSession;
  daemonJobId: string;
  startedAt: Date;
  lifetimeMs: number;
};

async function dispatchBashJob(
  deps: BashJobStartDependencies,
): Promise<BashJobStart> {
  const { tenantDb, connector, config, context, machine, input } = deps;
  const startedAt = new Date();
  const daemonJobId = randomBytes(16).toString('hex');

  const lifetimeMs =
    input.unlimited === true ? 0 : config.config.tools.jobs.maxSeconds * 1000;

  const machineClient = await connector.jobsClient(machine.name);

  const binding = await bindBashAttempt({
    tenantDb,
    context,
    machine,
    daemonJobId,
    startedAt,
    lifetimeMs,
    instanceId: machineClient.instanceId,
    delivery: input.async === true ? 'background' : 'foreground',
    command: input.command,
  });

  if ('prior' in binding) return { kind: 'failed', result: binding.prior };

  return createBoundBashJob({
    deps,
    binding: binding.row,
    machineClient,
    daemonJobId,
    startedAt,
    lifetimeMs,
  });
}

async function createBoundBashJob(
  input: CreateBoundBashJobInput,
): Promise<BashJobStart> {
  const { deps, binding, machineClient, daemonJobId, startedAt, lifetimeMs } =
    input;

  const result = await createDaemonJob({
    client: machineClient.client,
    callOptions: machineClient.callOptions,
    context: deps.context,
    machine: deps.machine,
    input: deps.input,
    daemonJobId,
    lifetimeMs,
  }).catch(() => settleUnknownCreate(input));

  if (result.kind === 'failed') return result;

  if (result.kind === 'started') return result;

  if (result.kind === 'known-refusal')
    return settleRefusedStart(
      deps.tenantDb,
      deps.context,
      binding,
      result.result,
    );

  deps.context.onHostCommandStarted?.();

  return {
    kind: 'started',
    row: binding,
    client: machineClient.client,
    callOptions: machineClient.callOptions,
    ended: machineClient.ended,
    daemonJobId,
    startedAt,
    lifetimeMs,
  };
}

async function settleUnknownCreate(
  input: CreateBoundBashJobInput,
): Promise<BashJobStart> {
  const { deps, binding, machineClient, daemonJobId } = input;

  const listed = await machineClient.client
    .listJobs({}, machineClient.callOptions())
    .catch(() => undefined);

  const unknown = machineUnknownResult(deps.machine.name);

  if (
    listed !== undefined &&
    !listed.jobs.some((job) => job.id === daemonJobId)
  ) {
    const lostJob = create(JobSchema, {
      id: daemonJobId,
      owner: deps.context.userId,
      state: JobState.LOST,
      lostCause: LostCause.DAEMON_RESTARTED,
    });

    await deps.settleLost(binding, lostJob);
  }

  await recordNativeResult(deps.tenantDb, deps.context, unknown);

  return { kind: 'failed', result: unknown };
}

async function settleRefusedStart(
  tenantDb: TenantRunner,
  context: ToolContext,
  row: ChatJob,
  result: ToolResult,
): Promise<BashJobStart> {
  await removeUnstartedRow(tenantDb, row);
  const settled = await recordNativeResult(tenantDb, context, result);

  return { kind: 'failed', result: settled };
}

type BashBinding = { row: ChatJob } | { prior: ToolResult };

type BindBashAttemptInput = {
  tenantDb: TenantRunner;
  context: ToolContext;
  machine: BashMachineTarget;
  daemonJobId: string;
  startedAt: Date;
  lifetimeMs: number;
  instanceId: string;
  delivery: 'foreground' | 'background';
  command: string;
};

type NativeBashIdentity = {
  runId: string;
  attemptId: string;
  toolCallId: string;
};

async function bindBashAttempt(
  input: BindBashAttemptInput,
): Promise<BashBinding> {
  const { context, startedAt, lifetimeMs } = input;

  const { runId, attemptId, toolCallId } = context;

  if (!runId || !attemptId || !toolCallId)
    throw new Error('The Run identity is unavailable.');

  const deadlineAt =
    lifetimeMs === 0 ? undefined : new Date(startedAt.getTime() + lifetimeMs);

  return input.tenantDb.runAs(context.userId, (db) =>
    bindBashAttemptInTransaction(
      db,
      input,
      { runId, attemptId, toolCallId },
      deadlineAt,
    ),
  );
}

async function bindBashAttemptInTransaction(
  db: Db,
  input: BindBashAttemptInput,
  identity: NativeBashIdentity,
  deadlineAt: Date | undefined,
): Promise<BashBinding> {
  const { context, machine } = input;

  if (
    (await new ChatsRepository(db).lock(context.chatId, context.userId)) ===
    undefined
  ) {
    return {
      prior: unavailable('This Run cannot use this native executor.'),
    };
  }

  const { runId, attemptId, toolCallId } = identity;

  const prior = await new NativeFilesRepository(db).begin({
    runId,
    userId: context.userId,
    fence: { bound: false },
    deliverySequence: context.nativeDeliverySequence,
    attemptId,
    toolCallId,
    operation: 'bash',
    path: machine.locator ?? machine.name,
  });

  if (prior !== undefined) return { prior };

  return insertChatJobBinding(db, input, identity, deadlineAt);
}

async function insertChatJobBinding(
  db: Db,
  input: BindBashAttemptInput,
  identity: NativeBashIdentity,
  deadlineAt: Date | undefined,
): Promise<BashBinding> {
  const { context, machine, daemonJobId, startedAt, instanceId } = input;
  const { runId, toolCallId } = identity;

  const seq = await new ArtifactsRepository(db).nextSeq(
    context.chatId,
    context.userId,
  );

  if (seq === undefined) throw new Error('The Chat cannot store an artifact.');

  return {
    row: await insertBashBinding(new ChatJobsRepository(db), {
      context,
      machine,
      daemonJobId,
      startedAt,
      instanceId,
      seq,
      delivery: input.delivery,
      command: input.command,
      deadlineAt,
      runId,
      toolCallId,
    }),
  };
}

type InsertBashBindingInput = {
  context: ToolContext;
  machine: BashMachineTarget;
  daemonJobId: string;
  startedAt: Date;
  instanceId: string;
  delivery: 'foreground' | 'background';
  command: string;
  seq: number;
  deadlineAt: Date | undefined;
  runId: string;
  toolCallId: string;
};

async function insertBashBinding(
  repository: ChatJobsRepository,
  input: InsertBashBindingInput,
): Promise<ChatJob> {
  const {
    context,
    machine,
    daemonJobId,
    startedAt,
    instanceId,
    seq,
    deadlineAt,
    runId,
    toolCallId,
  } = input;

  return repository.insert({
    chatId: context.chatId,
    ownerUserId: context.userId,
    kind: 'bash',
    seq,
    runId,
    toolCallId,
    intent: context.toolIntent,
    machineName: machine.name,
    daemonInstanceId: instanceId,
    daemonJobId,
    delivery: input.delivery,
    command: input.command,
    startedAt,
    ...(deadlineAt !== undefined && { deadlineAt }),
    outputs: ['stdout', 'stderr'],
    artifactReadable: context.artifactReadable === true,
    settings: context.jobSettings ?? {
      selector: 'unknown',
      permissionMode: 'default',
    },
  });
}

type CreateDaemonJobInput = {
  client: JobsClient;
  callOptions: JobsCallOptions;
  context: ToolContext;
  machine: BashMachineTarget;
  input: BashInput;
  daemonJobId: string;
  lifetimeMs: number;
};

type CreateDaemonJobResult =
  | { kind: 'created' }
  | { kind: 'known-refusal'; result: ToolResult };

async function createDaemonJob(
  input: CreateDaemonJobInput,
): Promise<CreateDaemonJobResult> {
  try {
    const response = await sendCreateJob(input);

    if (response.result.case === 'failure')
      return {
        kind: 'known-refusal',
        result: unavailable(response.result.value.message),
      };

    return { kind: 'created' };
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.DeadlineExceeded)
      throw error;

    const refusal = mapMachineRefusal(input.machine.name, error, true);

    if (!(refusal instanceof MachineProtocolError)) throw refusal;

    return {
      kind: 'known-refusal',
      result: machineProtocolFailureResult(input.machine.name, refusal),
    };
  }
}

async function sendCreateJob(
  input: CreateDaemonJobInput,
): Promise<CreateJobResponse> {
  const {
    client,
    callOptions,
    context,
    machine,
    input: bashInput,
    daemonJobId,
    lifetimeMs,
  } = input;

  const toolCallId = context.toolCallId;

  if (!toolCallId) throw new Error('The Run identity is unavailable.');

  return client.createJob(
    {
      jobId: daemonJobId,
      owner: context.userId,
      command: bashInput.command,
      ...(machine.path !== undefined && { cwd: machine.path }),
      ...(bashInput.env !== undefined && { env: bashInput.env }),
      ...(lifetimeMs > 0 && {
        timeout: { seconds: BigInt(lifetimeMs / 1000), nanos: 0 },
      }),
    },
    callOptions({
      envelope: { toolCallId, budgetMs: context.timeoutMs ?? 30_000 },
    }),
  );
}

async function removeUnstartedRow(
  tenantDb: TenantRunner,
  row: ChatJob,
): Promise<void> {
  await tenantDb.runAs(row.ownerUserId, (db) =>
    new ChatJobsRepository(db).deleteRunning(
      row.chatId,
      row.ownerUserId,
      row.id,
    ),
  );
}

async function recordNativeResult(
  tenantDb: TenantRunner,
  context: ToolContext,
  result: ToolResult,
): Promise<ToolResult> {
  const { runId, attemptId, toolCallId } = context;

  if (!runId || !attemptId || !toolCallId)
    throw new Error('The Run identity is unavailable.');

  return tenantDb.runAs(context.userId, async (db) => {
    const receipt = await new NativeFilesRepository(db).recoverHostPromotion({
      runId,
      userId: context.userId,
      attemptId,
      toolCallId,
      result,
    });

    return receipt.result;
  });
}

function unavailable(message: string): ToolResult {
  return { status: 'error', type: 'executor_unavailable', message };
}
