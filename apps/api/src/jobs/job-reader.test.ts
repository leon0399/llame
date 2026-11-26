import { create } from '@bufbuild/protobuf';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { drizzle } from 'drizzle-orm/postgres-js';
import {
  BASH_BOUNDS,
  JobService,
  ReadOutputResponseSchema,
} from '@workspace/machine-protocol';
import { isString } from '@workspace/runtime-safety';

import { type ChatJob } from '../db/schema';
import { type TenantRunner } from '../db/tenant-db.service';
import { localMachineConnector } from '../testing/local-machine';
import { type ToolContext, type ToolResult } from '../tools/types';
import { ChatJobsRepository } from './chat-jobs.repository';
import { readJob } from './job-reader';

const SECRET = 'configured-secret-canary-123456789';
const USER_ID = 'owner-1';
const CHAT_ID = 'chat-1';

type ReadRequest = { readonly offset: bigint; readonly limit: bigint };

type OutputChunk = { readonly data: Uint8Array };

type ReadOutput = (request: ReadRequest) => AsyncIterable<OutputChunk>;

function contextOf(readOutput: ReadOutput): ToolContext {
  const db = drizzle.mock();
  const runAs: TenantRunner['runAs'] = (_userId, fn) => fn(db);
  const machines = localMachineConnector();

  const transport = createRouterTransport((router) => {
    router.service(JobService, {
      async *readOutput(request) {
        const output = readOutput({
          offset: request.offset,
          limit: request.limit,
        });

        for await (const part of output) {
          yield create(ReadOutputResponseSchema, {
            offset: request.offset,
            data: part.data,
          });
        }
      },
    });
  });

  const client = createClient(JobService, transport);

  vi.spyOn(machines, 'jobsClient').mockResolvedValue({
    client,
    callOptions: () => ({}),
    ended: Promise.resolve({ reason: 'closed', established: true }),
    instanceId: 'daemon-id',
  });

  const job: ChatJob = {
    id: 'job-id',
    chatId: CHAT_ID,
    ownerUserId: USER_ID,
    kind: 'bash',
    seq: 1,
    runId: 'run-id',
    toolCallId: 'call-1',
    machineName: 'host-a',
    daemonInstanceId: 'daemon-id',
    daemonJobId: 'daemon-job-id',
    delivery: 'background',
    startedAt: new Date(),
    deadlineAt: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    state: 'running',
    stoppedBy: null,
    result: null,
    artifactId: null,
    outputs: ['stdout', 'stderr'],
    artifactReadable: true,
    settings: { selector: 'gpt-5.5', permissionMode: 'default' },
    settledAt: null,
  };

  vi.spyOn(ChatJobsRepository.prototype, 'findByLocator').mockResolvedValue(job);

  return {
    configuredCredentials: [SECRET],
    userId: USER_ID,
    chatId: CHAT_ID,
    tenantDb: { runAs },
    machines,
  };
}

function contentOf(result: ToolResult): string {
  if (result.status !== 'success' || !isString(result['content'])) {
    throw new Error(
      `Expected a successful read, got ${JSON.stringify(result)}`,
    );
  }

  return result['content'];
}

function outputAt(text: string): ReadOutput {
  const bytes = Buffer.from(text);

  return async function* ({ offset, limit }) {
    await Promise.resolve();

    const start = Number(offset);
    const end = Math.min(bytes.length, start + Number(limit));
    const data = bytes.subarray(start, end);

    if (data.length > 0) yield { data };
  };
}

function splitOutput(text: string, split: number): ReadOutput {
  const bytes = Buffer.from(text);
  let sent = false;

  return async function* () {
    await Promise.resolve();

    if (sent) return;
    sent = true;
    yield { data: bytes.subarray(0, split) };
    yield { data: bytes.subarray(split) };
  };
}

afterEach(() => vi.restoreAllMocks());

describe('readJob live output redaction', () => {
  it('redacts credentials split across ReadOutput chunks', async () => {
    const result = await readJob(
      contextOf(splitOutput(`before ${SECRET} after`, 12)),
      'read',
      'job://bash-1/stdout',
    );

    const content = contentOf(result);

    expect(content).not.toContain(SECRET);
    expect(content).toContain('before ');
    expect(content).toContain(' after');
  });

  it('does not expose a credential prefix cut by the live-read byte bound', async () => {
    const byteBound = BASH_BOUNDS.outputBound * 4;
    const prefixLength = 9;
    const text = `${'x'.repeat(byteBound - prefixLength)}${SECRET} beyond-bound`;

    const result = await readJob(
      contextOf(outputAt(text)),
      'read',
      'job://bash-1/stdout',
    );

    const content = contentOf(result);

    expect(content).not.toContain(SECRET.slice(0, prefixLength));
    expect(content).not.toContain(SECRET);
    expect(content.length).toBeLessThanOrEqual(BASH_BOUNDS.outputBound);
  });
});
