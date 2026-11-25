import { randomBytes } from 'node:crypto';
import { type Client, type CallOptions } from '@connectrpc/connect';
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
import { ChatJobsRepository } from './chat-jobs.repository';

export type BashJobStart =
  | {
      kind: 'started';
      row: ChatJob;
      client: Client<typeof JobService>;
      callOptions: (options?: MachineRequestOptions) => CallOptions;
      ended: Promise<unknown>;
      daemonJobId: string;
      startedAt: Date;
      lifetimeMs: number;
    }
  | { kind: 'failed'; result: ToolResult };

export async function startBashJob(deps: {
  tenantDb: TenantRunner;
  connector: {
    jobsClient(machineName: string): Promise<{
      client: Client<typeof JobService>;
      instanceId: string;
      ended: Promise<unknown>;
      callOptions: (options?: MachineRequestOptions) => CallOptions;
    }>;
  };
  config: InstanceConfigReader;
  context: ToolContext;
  machine: BashMachineTarget;
  input: BashInput;
}): Promise<BashJobStart> {
  const { tenantDb, connector, config, context, machine, input } = deps;
  const { runId, toolCallId } = context;
  if (!runId || !toolCallId)
    return {
      kind: 'failed',
      result: unavailable('The Run identity is unavailable.'),
    };
  if (input.unlimited === true && context.allowUnlimitedJobs !== true)
    return {
      kind: 'failed',
      result: unavailable(
        'tools.jobs.allowUnlimited is false; unlimited jobs are not allowed.',
      ),
    };

  const startedAt = new Date();
  const daemonJobId = randomBytes(16).toString('hex');
  const lifetimeMs =
    input.unlimited === true ? 0 : config.config.tools.jobs.maxSeconds * 1000;
  const { client, instanceId, ended, callOptions } = await connector.jobsClient(
    machine.name,
  );
  const seq = await reserveArtifactSeq(tenantDb, {
    chatId: context.chatId,
    userId: context.userId,
  });
  const deadlineAt =
    lifetimeMs === 0 ? undefined : new Date(startedAt.getTime() + lifetimeMs);
  const row = await tenantDb.runAs(context.userId, (db) =>
    new ChatJobsRepository(db).insert({
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
    }),
  );
  const removeUnstartedRow = () =>
    tenantDb.runAs(context.userId, (db) =>
      new ChatJobsRepository(db).deleteRunning(
        row.chatId,
        row.ownerUserId,
        row.id,
      ),
    );
  let started: CreateJobResponse;
  try {
    started = await client.createJob(
      {
        jobId: daemonJobId,
        owner: context.userId,
        command: input.command,
        ...(machine.path !== undefined && { cwd: machine.path }),
        ...(input.env !== undefined && { env: input.env }),
        ...(lifetimeMs > 0 && {
          timeout: { seconds: BigInt(lifetimeMs / 1000), nanos: 0 },
        }),
      },
      callOptions({
        envelope: { toolCallId, budgetMs: context.timeoutMs ?? 30_000 },
      }),
    );
  } catch (error) {
    const refusal = mapMachineRefusal(machine.name, error, true);
    if (
      !(refusal instanceof MachineProtocolError) ||
      refusal.code !== 'machine_job_limit'
    )
      throw refusal;
    await removeUnstartedRow();
    return {
      kind: 'failed',
      result: machineProtocolFailureResult(machine.name, refusal),
    };
  }
  if (started.result.case === 'failure') {
    await removeUnstartedRow();
    return {
      kind: 'failed',
      result: unavailable(started.result.value.message),
    };
  }
  context.onHostCommandStarted?.();
  return {
    kind: 'started',
    row,
    client,
    callOptions,
    ended,
    daemonJobId,
    startedAt,
    lifetimeMs,
  };
}

function unavailable(message: string): ToolResult {
  return { status: 'error', type: 'executor_unavailable', message };
}
