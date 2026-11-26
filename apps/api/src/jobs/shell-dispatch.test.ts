import { drizzle } from 'drizzle-orm/postgres-js';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CreateJobResponseSchema,
  JobSchema,
  JobService,
  JobState,
  type CreateJobRequest,
} from '@workspace/machine-protocol';
import { type Chat, type ChatJob } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { ChatsRepository } from '../chats/chats-repository';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { type BashMachineTarget } from '../tools/bash-target';
import { type ShellId } from '../tools/shell';
import { type ToolContext } from '../tools/types';
import { ChatJobsRepository } from './chat-jobs.repository';
import { startBashJob } from './bash-job-registry-start';

const machine: BashMachineTarget = { name: 'host-a', local: true };

function binding(): ChatJob {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    chatId: 'chat',
    ownerUserId: 'owner',
    kind: 'bash',
    seq: 1,
    state: 'running',
    stoppedBy: null,
    runId: 'run',
    toolCallId: 'call-1',
    machineName: 'host-a',
    daemonInstanceId: '00000000-0000-4000-8000-000000000013',
    daemonJobId: '0123456789abcdef0123456789abcdef',
    delivery: 'foreground',
    startedAt: new Date(0),
    settledAt: null,
    deadlineAt: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    result: null,
    outputs: ['stdout', 'stderr'],
    artifactId: null,
    artifactReadable: false,
    settings: { selector: 'test-model', permissionMode: 'default' },
  };
}

function lockedChat(): Chat {
  return {
    id: 'chat',
    ownerUserId: 'owner',
    title: null,
    visibility: 'private',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    projectId: null,
    skillCatalogBaseline: null,
    skillCatalogRebakedFrom: null,
    skillCatalogTold: null,
    workspaceRoot: null,
    workspaceExecutorId: null,
    workspaceGeneration: 0,
    workspaceTold: null,
    artifactSeq: 0,
    workspaceToldAvailable: null,
    workspaceToldFrom: null,
    workspaceDetachReason: null,
    modelSelection: null,
  };
}

/** One dispatch, answering with the request the daemon received. */
async function dispatched(shell: ShellId): Promise<CreateJobRequest> {
  vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue(lockedChat());
  vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
    undefined,
  );
  vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(1);
  vi.spyOn(ChatJobsRepository.prototype, 'insert').mockResolvedValue(binding());

  const requests: Array<CreateJobRequest> = [];

  const rpc = createRouterTransport((router) => {
    router.service(JobService, {
      createJob(request) {
        requests.push(request);

        return create(CreateJobResponseSchema, {
          result: {
            case: 'job',
            value: create(JobSchema, {
              id: request.jobId,
              owner: request.owner,
              state: JobState.RUNNING,
            }),
          },
        });
      },
      async *watchJobs() {
        await new Promise<never>(() => undefined);
        yield* [];
      },
    });
  });

  const tenantDb = {
    runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
      callback(drizzle.mock()),
  };

  const context: ToolContext = {
    configuredCredentials: [],
    userId: 'owner',
    chatId: 'chat',
    runId: 'run',
    attemptId: 'attempt-1',
    toolCallId: 'call-1',
    localMachine: 'host-a',
    defaultMachine: 'host-a',
    tenantDb,
  };

  await startBashJob({
    tenantDb,
    connector: {
      jobsClient: () =>
        Promise.resolve({
          client: createClient(JobService, rpc),
          callOptions: () => ({}),
          ended: new Promise<never>(() => undefined),
          instanceId: '00000000-0000-4000-8000-000000000013',
        }),
    },
    config: { config: BUILT_IN_DEFAULTS },
    context,
    machine,
    input: { command: 'printf hello' },
    shell,
    settleLost: () => Promise.resolve(),
  });

  const [request] = requests;

  if (request === undefined) throw new Error('No CreateJob request was sent.');

  return request;
}

afterEach(() => vi.restoreAllMocks());

describe('shell dispatch', () => {
  it('names zsh in the daemon request', async () => {
    expect((await dispatched('zsh')).shell).toBe('zsh');
  });

  it('leaves the field unset for bash', async () => {
    expect((await dispatched('bash')).shell).toBeUndefined();
  });
});
