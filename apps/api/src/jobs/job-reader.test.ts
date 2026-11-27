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

function baseJob(): ChatJob {
  return {
    id: 'job-id',
    chatId: CHAT_ID,
    ownerUserId: USER_ID,
    kind: 'bash',
    seq: 1,
    runId: 'run-id',
    toolCallId: 'call-1',
    intent: null,
    command: null,
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
}

function contextOf(
  readOutput: ReadOutput,
  jobOverrides: Partial<ChatJob> = {},
): ToolContext {
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

  const job: ChatJob = { ...baseJob(), ...jobOverrides };

  vi.spyOn(ChatJobsRepository.prototype, 'findByLocator').mockResolvedValue(
    job,
  );

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

describe('readJob record listing', () => {
  it('lists a running job without optional result metadata', async () => {
    const result = await readJob(
      contextOf(outputAt(''), {
        startedAt: new Date('2025-01-01T00:00:00.000Z'),
      }),
      'read',
      'job://bash-1',
    );

    expect(contentOf(result)).toContain('started_at: 2025-01-01T00:00:00.000Z');
    expect(contentOf(result)).toContain('state: running');
    expect(contentOf(result)).not.toContain('settled_at:');
    expect(contentOf(result)).not.toContain('stop_requested_by:');
    expect(contentOf(result)).not.toContain('exit_code:');
    expect(contentOf(result)).not.toContain('signal:');
    expect(contentOf(result)).not.toContain('truncated:');
    expect(contentOf(result)).not.toContain('artifact:');
    expect(contentOf(result)).not.toContain('intent:');
    expect(contentOf(result)).not.toContain('command:');
  });

  it('lists requested stop metadata for a running job', async () => {
    const result = await readJob(
      contextOf(outputAt(''), { stopRequestedBy: 'owner' }),
      'read',
      'job://bash-1',
    );

    expect(contentOf(result)).toContain('stop_requested_by: owner');
  });

  it('lists settled result and artifact metadata', async () => {
    const result = await readJob(
      contextOf(outputAt(''), {
        startedAt: new Date('2025-01-01T00:00:00.000Z'),
        settledAt: new Date('2025-01-01T00:00:05.000Z'),
        state: 'cancelled',
        stoppedBy: 'owner',
        result: {
          exitCode: 0,
          signal: 'SIGTERM',
          truncated: { stdout: true },
          outcomeUnknown: true,
          cause: 'stop_unproved',
        },
        artifactId: 'artifact-id',
      }),
      'read',
      'job://bash-1',
    );

    const content = contentOf(result);
    expect(content).toContain('settled_at: 2025-01-01T00:00:05.000Z');
    expect(content).toContain('stopped_by: owner');
    expect(content).not.toContain('stop_requested_by:');
    expect(content).toContain('exit_code: 0');
    expect(content).toContain('signal: SIGTERM');
    expect(content).toContain('truncated: stdout');
    expect(content).toContain('outcome: unknown (the stop was not proved)');
    expect(content).toContain('artifact:');
  });

  // The owner names jobs by their intent, so the model must find it here
  // after compaction drops its own earlier call.
  it('names the intent and the exact command in the record', async () => {
    const result = await readJob(
      contextOf(outputAt(''), {
        intent: 'Writing to both streams',
        command: 'echo out\necho err >&2',
      }),
      'read',
      'job://bash-1',
    );

    const content = contentOf(result);

    expect(content).toContain('intent: Writing to both streams');
    expect(content).toContain(String.raw`command: "echo out\necho err >&2"`);
  });

  it('lists each job with its intent, and a job without one bare', async () => {
    vi.spyOn(ChatJobsRepository.prototype, 'listByChat').mockResolvedValue([
      { ...baseJob(), seq: 1, intent: '  Waiting  for\n reviews ' },
      { ...baseJob(), seq: 2, intent: null },
    ]);

    const lines = contentOf(
      await readJob(contextOf(outputAt('')), 'read', 'job://'),
    );

    expect(lines).toMatch(
      /job:\/\/bash-1 \(running, [^)]+\): Waiting for reviews$/m,
    );
    expect(lines).toMatch(/job:\/\/bash-2 \(running, [^)]+\)$/m);
  });
});

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
