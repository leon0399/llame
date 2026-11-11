import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { eq } from 'drizzle-orm';
import {
  type BashResult,
  type ManagedBashHandle,
  type ManagedOutput,
  type ManagedStopResult,
} from '@workspace/bash-executor';

import * as schema from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository } from '../chats/chats-repository';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { readJob } from './job-reader';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { BashJobRegistry, type BashJobFacts } from './bash-job-registry';
import { ChatJobsRepository } from './chat-jobs.repository';
import { retryJobTransaction } from './bash-job-store';
import {
  commitArtifactInTransaction,
  reserveArtifactSeq,
} from '../tools/artifacts/artifact-writer';
import * as hostFiles from '../tools/artifacts/host-files';
import { type WorkerHeartbeatService } from './worker-heartbeat.service';

class Command implements ManagedBashHandle {
  readonly pid = 12_345;
  private readonly result = Promise.withResolvers<BashResult>();
  readonly settled = this.result.promise;
  private listeners = new Set<(bytes: number) => void>();
  private output: ManagedOutput = { stdout: '', stderr: '', truncated: false };
  readonly stop = vi.fn((cause: string): Promise<ManagedStopResult> => {
    this.result.resolve({ status: 'error', type: 'cancelled', message: cause });

    return Promise.resolve({ ...this.output, proved: this.proved });
  });
  proved = true;
  snapshot(): ManagedOutput {
    return this.output;
  }
  onOutput(listener: (bytes: number) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }
  print(text: string): void {
    this.output = { ...this.output, stdout: this.output.stdout + text };

    for (const listener of this.listeners) listener(Buffer.byteLength(text));
  }
  exit(code: number, signal?: NodeJS.Signals): void {
    this.result.resolve({
      status: code === 0 ? 'success' : 'error',
      exitCode: code,
      signal,
      ...this.output,
    });
  }
  lost(): void {
    this.result.resolve({
      status: 'error',
      type: 'outcome_unknown',
      attemptId: 'unknown',
      message: 'Unknown.',
    });
  }
}

const config: InstanceConfigReader = { config: BUILT_IN_DEFAULTS };
const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

d('BashJobRegistry', () => {
  let client: Sql;
  let tenant: TenantDbService;
  let owner: string;
  let worker: Pick<WorkerHeartbeatService, 'instanceId'>;
  let registry: BashJobRegistry;
  let facts: BashJobFacts;

  beforeAll(async () => {
    client = postgres(process.env.TEST_DATABASE_URL!, { max: 5 });
    tenant = new TenantDbService(drizzle(client, { schema }));
    owner = crypto.randomUUID();
    worker = { instanceId: crypto.randomUUID() };
    await client`INSERT INTO users (id,name,email) VALUES (${owner}, 'Runtime', ${`${owner}@test.com`})`;
    await client`INSERT INTO worker_instances (id) VALUES (${worker.instanceId})`;
  });
  beforeEach(async () => {
    registry = new BashJobRegistry(tenant, worker, config);

    const chat = await tenant.runAs(owner, (db) =>
      new ChatsRepository(db).create({
        ownerUserId: owner,
        title: 'Job runtime',
      }),
    );

    facts = {
      ownerUserId: owner,
      chatId: chat.id,
      runId: crypto.randomUUID(),
      toolCallId: crypto.randomUUID(),
      startedAt: new Date(),
      settings: { modelId: 'gpt-5.5', permissionMode: 'default' },
      maxBytes: 65_536,
      configuredCredentials: [],
      artifactReadable: true,
      hostFiles: false,
    };
  });
  afterEach(async () => {
    vi.useRealTimers();
    await registry.shutdown();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await client`DELETE FROM users WHERE id = ${owner}`;
    await client`DELETE FROM worker_instances WHERE id = ${worker.instanceId}`;
    await client.end();
  });

  const row = (id: string) =>
    tenant.runAs(owner, (db) =>
      new ChatJobsRepository(db).findById(facts.chatId, owner, id),
    );

  const output = (id: string) =>
    tenant.runAs(owner, (db) =>
      new ChatJobsRepository(db).readOutput(owner, id, 'stdout'),
    );

  async function ended(id: string, state: string): Promise<void> {
    await vi.waitFor(async () => {
      expect((await row(id))?.state).toBe(state);
    });
  }

  it('keeps the starting Run facts and output at promotion', async () => {
    const command = new Command();
    command.print('before promotion\n');
    const job = await registry.promote(command, facts);
    expect(job).toMatchObject({
      runId: facts.runId,
      toolCallId: facts.toolCallId,
      workerInstanceId: worker.instanceId,
      pid: 12_345,
      settings: facts.settings,
      artifactReadable: true,
    });
    expect(job.deadlineAt!.getTime() - facts.startedAt.getTime()).toBe(
      7_200_000,
    );
    expect((await output(job.id)).toString()).toBe('before promotion\n');
  });

  it('stops a command when its promotion fails', async () => {
    const command = new Command();
    await expect(
      registry.promote(command, { ...facts, chatId: crypto.randomUUID() }),
    ).rejects.toThrow('The Chat cannot store an artifact.');
    expect(command.stop).toHaveBeenCalledWith('run');
  });

  it('A quiet job writes nothing', async () => {
    const command = new Command();
    const job = await registry.promote(command, facts);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    await vi.advanceTimersByTimeAsync(600_000);
    vi.useRealTimers();
    expect((await output(job.id)).length).toBe(0);

    const chunks = await tenant.runAs(owner, (db) =>
      db
        .select()
        .from(schema.chatJobChunks)
        .where(eq(schema.chatJobChunks.jobId, job.id)),
    );

    expect(chunks).toEqual([]);
  });

  it('A stored line is readable two seconds later; A resumed Run on another worker reads a job', async () => {
    const command = new Command();
    const job = await registry.promote(command, facts);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    command.print('stored line\n');
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    await vi.waitFor(async () => {
      expect((await output(job.id)).toString()).toBe('stored line\n');
    });

    const read = await readJob(
      {
        userId: owner,
        chatId: facts.chatId,
        tenantDb: tenant,
        configuredCredentials: [],
        permissionPolicy: compileTestPermissionPolicy(),
      },
      'read',
      `job://bash-${job.seq}/stdout`,
    );

    expect(JSON.stringify(read)).toContain('stored line');
  });

  it('A credential across two increments with the cut inside the value', async () => {
    const secret = 'provider-key-secret-123456789';
    const prefix = 'a'.repeat(16_380);

    const handle = registry.start(
      {
        command: 'bash',
        args: [
          '-c',
          `printf '%s' '${prefix}${secret.slice(0, 10)}'; sleep 1.5; printf '%s' '${secret.slice(10)}'; sleep 0.1`,
        ],
      },
      {
        workingDirectory: process.cwd(),
        secretBoundary: true,
        processIsolation: true,
        inputBound: 32_768,
        outputBoundBytes: 65_536,
        durationMs: 1,
        maxProcesses: 1,
      },
      { protectedValues: [secret] },
    );

    if (!('pid' in handle)) throw new Error('Command did not start');

    const job = await registry.promote(handle, {
      ...facts,
      artifactReadable: false,
      configuredCredentials: [secret],
    });

    await vi.waitFor(
      async () => {
        expect((await output(job.id)).toString()).toBe(prefix);
      },
      { timeout: 1400 },
    );
    await handle.settled;
    await ended(job.id, 'succeeded');
    const stored = (await output(job.id)).toString();
    expect(stored).toBe(`${prefix}[REDACTED]`);
    expect(stored).not.toContain(secret.slice(0, 10));
  });

  it.each([
    [0, 'succeeded'],
    [2, 'failed'],
  ] as const)(
    'A failing build settles as failed (exit %s)',
    async (code, state) => {
      const command = new Command();
      const job = await registry.promote(command, facts);
      command.print('build\n');
      command.exit(code);
      await ended(job.id, state);
      expect((await row(job.id))?.result?.exitCode).toBe(code);
      expect((await output(job.id)).toString()).toBe('build\n');
    },
  );

  it('records the signal that ends a command', async () => {
    const command = new Command();
    const job = await registry.promote(command, facts);
    command.exit(1, 'SIGTERM');
    await ended(job.id, 'failed');
    expect((await row(job.id))?.result?.signal).toBe('SIGTERM');
  });

  it('A survivor makes the outcome unknown', async () => {
    const command = new Command();
    const job = await registry.promote(command, facts);
    command.print('kept');
    command.lost();
    await ended(job.id, 'lost');
    expect((await row(job.id))?.result?.outcomeUnknown).toBe(true);
    expect((await output(job.id)).toString()).toBe('kept');
  });

  it('A job artifact after the Run ended includes every output under its reserved number', async () => {
    const command = new Command();
    const job = await registry.promote(command, facts);
    command.print('a'.repeat(50_000));
    command.exit(0);
    await ended(job.id, 'succeeded');
    const settled = await row(job.id);
    expect(settled?.artifactId).not.toBeNull();

    const artifacts = await tenant.runAs(owner, (db) =>
      db
        .select()
        .from(schema.toolArtifacts)
        .where(eq(schema.toolArtifacts.id, settled!.artifactId!)),
    );

    expect(artifacts[0]).toMatchObject({
      seq: job.seq,
      runId: facts.runId,
      toolCallId: facts.toolCallId,
    });

    const parts = await tenant.runAs(owner, (db) =>
      db
        .select()
        .from(schema.toolArtifactParts)
        .where(eq(schema.toolArtifactParts.artifactId, settled!.artifactId!)),
    );

    expect(parts.map((part) => part.name).sort()).toEqual(['stderr', 'stdout']);
    expect(
      parts.find((part) => part.name === 'stdout')?.content.toString(),
    ).toBe('a'.repeat(50_000));
    expect((await output(job.id)).length).toBe(0);
  });

  it('A short output creates no artifact; A record of a failed job', async () => {
    const command = new Command();
    const job = await registry.promote(command, facts);
    command.print('x'.repeat(300));
    command.exit(2);
    await ended(job.id, 'failed');
    expect((await row(job.id))?.artifactId).toBeNull();

    const read = await readJob(
      {
        userId: owner,
        chatId: facts.chatId,
        tenantDb: tenant,
        configuredCredentials: [],
        permissionPolicy: compileTestPermissionPolicy(),
      },
      'read',
      `job://bash-${job.seq}`,
    );

    expect(JSON.stringify(read)).toContain('exit_code: 2');
  });

  it('A failed write keeps the stored increments', async () => {
    const command = new Command();
    const job = await registry.promote(command, facts);

    const seq = await reserveArtifactSeq(tenant, {
      chatId: facts.chatId,
      userId: owner,
    });

    await tenant.runAs(owner, (db) =>
      commitArtifactInTransaction(
        db,
        {
          chatId: facts.chatId,
          userId: owner,
          runId: facts.runId,
          toolCallId: facts.toolCallId,
          toolName: 'bash',
          complete: true,
          parts: [
            {
              name: 'stdout',
              contentType: 'text/plain',
              content: Buffer.from('duplicate call'),
            },
          ],
        },
        seq,
        facts.maxBytes,
      ),
    );
    command.print('x'.repeat(3000));
    command.exit(0);
    await ended(job.id, 'succeeded');
    expect((await row(job.id))?.artifactId).toBeNull();
    expect((await output(job.id)).toString()).toBe('x'.repeat(3000));
  });

  it.each([true, false])(
    'A hung build ends at the lifetime; A host command ends at the job lifetime (proof %s)',
    async (proved) => {
      const command = new Command();
      command.proved = proved;
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      const job = await registry.promote(command, facts);
      command.print('before lifetime');
      await vi.advanceTimersByTimeAsync(7_200_000);
      vi.useRealTimers();
      await ended(job.id, proved ? 'timed_out' : 'lost');
      expect(command.stop).toHaveBeenCalledWith('lifetime');
      expect((await output(job.id)).toString()).toBe('before lifetime');
    },
  );

  it('keeps the starting host-file decision and writes files only after commit', async () => {
    const command = new Command();
    let committed = false;

    const write = vi
      .spyOn(hostFiles, 'writeArtifactHostFiles')
      .mockImplementation(async () => {
        committed =
          (
            await tenant.runAs(owner, (db) =>
              new ChatJobsRepository(db).listByChat(facts.chatId, owner),
            )
          )[0]?.artifactId != null;

        return '/tmp/job-artifact';
      });

    const job = await registry.promote(command, { ...facts, hostFiles: true });
    command.print('x'.repeat(3000));
    command.exit(0);
    await ended(job.id, 'succeeded');
    await vi.waitFor(() => {
      expect(write).toHaveBeenCalledTimes(1);
    });
    expect(committed).toBe(true);
  });

  it('A deploy ends a job and refuses later commands and promotions', async () => {
    const command = new Command();
    const job = await registry.promote(command, facts);
    command.print('before deploy');
    await registry.shutdown();
    expect(await row(job.id)).toMatchObject({
      state: 'cancelled',
      stoppedBy: 'worker',
    });
    expect((await output(job.id)).toString()).toBe('before deploy');
    const late = new Command();
    await expect(registry.promote(late, facts)).rejects.toThrow(
      'shutting down',
    );
    expect(late.stop).toHaveBeenCalledWith('run');
    expect(
      registry.start(
        { command: 'bash' },
        {
          workingDirectory: process.cwd(),
          secretBoundary: true,
          processIsolation: true,
          inputBound: 512,
          outputBoundBytes: 65_536,
          durationMs: 1,
          maxProcesses: 1,
        },
      ),
    ).toMatchObject({ type: 'unavailable' });
  });
});

describe('settlement transaction retry', () => {
  it.each(['40P01', '40001'])(
    'retries %s including a Drizzle wrapped cause',
    async (code) => {
      const work = vi
        .fn()
        .mockRejectedValueOnce({ cause: { code } })
        .mockResolvedValue('settled');

      expect(await retryJobTransaction(work)).toBe('settled');
      expect(work).toHaveBeenCalledTimes(2);
    },
  );
  it('does not retry unrelated failures', async () => {
    const work = vi.fn().mockRejectedValue(new Error('unrelated'));
    await expect(retryJobTransaction(work)).rejects.toThrow('unrelated');
    expect(work).toHaveBeenCalledTimes(1);
  });
});
