import { randomBytes } from 'node:crypto';
import { type CallOptions, type Client } from '@connectrpc/connect';
import {
  JobService,
  MachineProtocolError,
  type CreateJobResponse,
} from '@workspace/machine-protocol';
import { type ChatJob } from '../db/schema';
import { type TenantRunner } from '../db/tenant-db.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { mapMachineRefusal } from '../machines/machine-session-errors';
import type { MachineRequestOptions } from '../machines/machine-session';
import { reserveArtifactSeq } from '../tools/artifacts/artifact-writer';
import { machineProtocolFailureResult } from '../tools/machine-call';
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

export async function startBashJob(deps: {
  tenantDb: TenantRunner;
  connector: Connector;
  config: InstanceConfigReader;
  context: ToolContext;
  machine: BashMachineTarget;
  input: BashInput;
}): Promise<BashJobStart> {
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

async function dispatchBashJob(deps: {
  tenantDb: TenantRunner;
  connector: Connector;
  config: InstanceConfigReader;
  context: ToolContext;
  machine: BashMachineTarget;
  input: BashInput;
}): Promise<BashJobStart> {
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

async function createBoundBashJob(input: {
  deps: {
    tenantDb: TenantRunner;
    context: ToolContext;
    machine: BashMachineTarget;
    input: BashInput;
  };
  binding: ChatJob;
  machineClient: MachineJobsSession;
  daemonJobId: string;
  startedAt: Date;
  lifetimeMs: number;
}): Promise<BashJobStart> {
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
  });

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
};

async function bindBashAttempt(
  input: BindBashAttemptInput,
): Promise<BashBinding> {
  const {
    tenantDb,
    context,
    machine,
    daemonJobId,
    startedAt,
    lifetimeMs,
    instanceId,
  } = input;

  const runId = context.runId;
  const attemptId = context.attemptId;
  const toolCallId = context.toolCallId;

  if (!runId || !attemptId || !toolCallId)
    throw new Error('The Run identity is unavailable.');

  const seq = await reserveArtifactSeq(tenantDb, {
    chatId: context.chatId,
    userId: context.userId,
  });

  const deadlineAt =
    lifetimeMs === 0 ? undefined : new Date(startedAt.getTime() + lifetimeMs);

  return tenantDb.runAs(context.userId, async (db) => {
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

    const row = await insertBashBinding(new ChatJobsRepository(db), {
      context,
      machine,
      daemonJobId,
      startedAt,
      instanceId,
      seq,
      deadlineAt,
      runId,
      toolCallId,
    });

    return { row };
  });
}

async function insertBashBinding(
  repository: ChatJobsRepository,
  input: {
    context: ToolContext;
    machine: BashMachineTarget;
    daemonJobId: string;
    startedAt: Date;
    instanceId: string;
    seq: number;
    deadlineAt: Date | undefined;
    runId: string;
    toolCallId: string;
  },
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
    machineName: machine.name,
    daemonInstanceId: instanceId,
    daemonJobId,
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

async function createDaemonJob(
  input: CreateDaemonJobInput,
): Promise<
  { kind: 'created' } | { kind: 'known-refusal'; result: ToolResult }
> {
  try {
    const response = await sendCreateJob(input);

    if (response.result.case === 'failure')
      return {
        kind: 'known-refusal',
        result: unavailable(response.result.value.message),
      };

    return { kind: 'created' };
  } catch (error) {
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
