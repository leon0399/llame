import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { eq } from 'drizzle-orm';
import { type ManagedOutput } from '@workspace/bash-executor';

import * as schema from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository } from '../chats/chats-repository';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import {
  commitArtifactInTransaction,
  reserveArtifactSeq,
} from '../tools/artifacts/artifact-writer';
import * as hostFiles from '../tools/artifacts/host-files';
import { chatDeliveries, type ChatJob } from '../db/schema';
import * as jobNotices from './job-notices';
import {
  appendJobOutput,
  retryJobTransaction,
  settleBashJob,
} from './bash-job-store';
import { ChatJobsRepository, type JobSettlement } from './chat-jobs.repository';
import { readJob } from './job-reader';

const MAX_BYTES = 65_536;

const text = (stdout: string): ManagedOutput => ({
  stdout,
  stderr: '',
  truncated: false,
  truncatedStreams: { stdout: false, stderr: false },
});

describe('bash-job-store on a live database', () => {
  let client: Sql;
  let tenant: TenantDbService;
  let owner: string;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;

    if (!url) throw new Error('Integration database was not provisioned.');
    client = postgres(url, { max: 5 });
    tenant = new TenantDbService(drizzle(client, { schema }));
    owner = crypto.randomUUID();
    await client`INSERT INTO users (id,name,email) VALUES (${owner}, 'Store', ${`${owner}@test.com`})`;
  });
  afterAll(async () => {
    await client`DELETE FROM users WHERE id = ${owner}`;
    await client.end();
  });
  afterEach(() => vi.restoreAllMocks());

  /** A running job with its reserved number, as a promotion stores it. */
  async function runningJob() {
    const chat = await tenant.runAs(owner, (db) =>
      new ChatsRepository(db).create({ ownerUserId: owner, title: 'Store' }),
    );

    const seq = await reserveArtifactSeq(tenant, {
      chatId: chat.id,
      userId: owner,
    });

    const job = await tenant.runAs(owner, (db) =>
      new ChatJobsRepository(db).insert({
        chatId: chat.id,
        ownerUserId: owner,
        executor: 'bash',
        seq,
        runId: crypto.randomUUID(),
        toolCallId: crypto.randomUUID(),
        workerInstanceId: crypto.randomUUID(),
        outputs: ['stdout', 'stderr'],
        artifactReadable: true,
        settings: { modelId: 'gpt-5.5', permissionMode: 'default' },
      }),
    );

    return job;
  }

  const settle = (
    job: Awaited<ReturnType<typeof runningJob>>,
    stdout: string,
    settlement: JobSettlement = { state: 'succeeded' },
    { hostFilesOn = false, stdoutOffset = 0 } = {},
  ) =>
    settleBashJob(
      tenant,
      job,
      {
        output: text(stdout),
        settlement,
        offsets: { stdout: stdoutOffset, stderr: 0 },
      },
      { maxBytes: MAX_BYTES, hostFiles: hostFilesOn },
    );

  const rowOf = (job: Awaited<ReturnType<typeof runningJob>>) =>
    tenant.runAs(owner, (db) =>
      new ChatJobsRepository(db).findById(job.chatId, owner, job.id),
    );

  const stdoutOf = (job: Awaited<ReturnType<typeof runningJob>>) =>
    tenant.runAs(owner, (db) =>
      new ChatJobsRepository(db).readOutput(owner, job.id, 'stdout'),
    );

  it('stores the whole output as an artifact under the reserved number, and drops the chunks', async () => {
    const job = await runningJob();

    await settle(job, 'a'.repeat(50_000));

    const settled = await rowOf(job);

    expect(settled?.artifactId).not.toBeNull();

    const [artifact] = await tenant.runAs(owner, (db) =>
      db
        .select()
        .from(schema.toolArtifacts)
        .where(eq(schema.toolArtifacts.id, settled!.artifactId!)),
    );

    expect(artifact).toMatchObject({
      seq: job.seq,
      runId: job.runId,
      toolCallId: job.toolCallId,
    });

    const parts = await tenant.runAs(owner, (db) =>
      db
        .select()
        .from(schema.toolArtifactParts)
        .where(eq(schema.toolArtifactParts.artifactId, artifact.id)),
    );

    expect(parts.map((part) => part.name).sort()).toEqual(['stderr', 'stdout']);
    expect(
      parts.find((part) => part.name === 'stdout')?.content.toString(),
    ).toBe('a'.repeat(50_000));
    expect((await stdoutOf(job)).length).toBe(0);

    const notices = await tenant.runAs(owner, (db) =>
      db
        .select()
        .from(chatDeliveries)
        .where(eq(chatDeliveries.senderRef, job.id)),
    );

    expect(notices).toHaveLength(1);
  });

  it('creates one notice when duplicate settlement attempts race', async () => {
    const job = await runningJob();

    await Promise.all([settle(job, 'first'), settle(job, 'second')]);

    const notices = await tenant.runAs(owner, (db) =>
      db
        .select()
        .from(chatDeliveries)
        .where(eq(chatDeliveries.senderRef, job.id)),
    );

    const stored = await stdoutOf(job);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      chatId: job.chatId,
      ownerUserId: owner,
      producer: 'job',
      senderRef: job.id,
      mode: 'notice',
      settings: job.settings,
    });
    expect(stored.toString()).toMatch(/^(first|second)$/);
  });

  it('rolls back the settlement, output, and notice together', async () => {
    const job = await runningJob();
    vi.spyOn(jobNotices, 'recordJobSettlementNotice').mockRejectedValue(
      new Error('notice insert failed'),
    );

    await expect(settle(job, 'not committed')).rejects.toThrow(
      'notice insert failed',
    );

    expect((await rowOf(job))?.state).toBe('running');
    expect((await stdoutOf(job)).length).toBe(0);

    const notices = await tenant.runAs(owner, (db) =>
      db
        .select()
        .from(chatDeliveries)
        .where(eq(chatDeliveries.senderRef, job.id)),
    );

    expect(notices).toEqual([]);
  });

  it('does not notify or settle a job through a foreign Chat id', async () => {
    const job = await runningJob();

    const foreignChat = await tenant.runAs(owner, (db) =>
      new ChatsRepository(db).create({ ownerUserId: owner, title: 'Other' }),
    );

    const wronglyScopedJob = {
      ...job,
      chatId: foreignChat.id,
    } satisfies ChatJob;

    await settle(wronglyScopedJob, 'not committed');

    expect(
      await tenant.runAs(owner, (db) =>
        new ChatJobsRepository(db).findById(job.chatId, owner, job.id),
      ),
    ).toMatchObject({ state: 'running' });

    const notices = await tenant.runAs(owner, (db) =>
      db
        .select()
        .from(chatDeliveries)
        .where(eq(chatDeliveries.senderRef, job.id)),
    );

    expect(notices).toEqual([]);
  });

  it('creates no artifact for a short output, and the record shows the exit code', async () => {
    const job = await runningJob();

    await settle(job, 'x'.repeat(300), {
      state: 'failed',
      result: { exitCode: 2 },
    });
    expect((await rowOf(job))?.artifactId).toBeNull();
    expect((await stdoutOf(job)).toString()).toBe('x'.repeat(300));

    const notices = await tenant.runAs(owner, (db) =>
      db
        .select()
        .from(chatDeliveries)
        .where(eq(chatDeliveries.senderRef, job.id)),
    );

    expect(notices).toHaveLength(1);

    const read = await readJob(
      {
        userId: owner,
        chatId: job.chatId,
        tenantDb: tenant,
        configuredCredentials: [],
        permissionPolicy: compileTestPermissionPolicy(),
      },
      'read',
      `job://bash-${job.seq}`,
    );

    expect(JSON.stringify(read)).toContain('exit_code: 2');
  });

  it('keeps the stored increments when the artifact write fails', async () => {
    const job = await runningJob();

    const taken = await reserveArtifactSeq(tenant, {
      chatId: job.chatId,
      userId: owner,
    });

    await tenant.runAs(owner, (db) =>
      commitArtifactInTransaction(
        db,
        {
          chatId: job.chatId,
          userId: owner,
          runId: job.runId,
          toolCallId: job.toolCallId,
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
        taken,
        MAX_BYTES,
      ),
    );

    // 100 bytes were committed by an earlier flush; the settlement carries all 3000.
    const prior = 'a'.repeat(100);
    const whole = prior + 'b'.repeat(2900);

    await tenant.runAs(owner, (db) =>
      appendJobOutput(db, job, text(prior), { stdout: 0, stderr: 0 }),
    );
    await settle(job, whole, { state: 'succeeded' }, { stdoutOffset: 100 });

    expect((await rowOf(job))?.state).toBe('succeeded');
    expect((await rowOf(job))?.artifactId).toBeNull();
    expect((await stdoutOf(job)).toString()).toBe(whole);

    const notices = await tenant.runAs(owner, (db) =>
      db
        .select()
        .from(chatDeliveries)
        .where(eq(chatDeliveries.senderRef, job.id)),
    );

    expect(notices).toHaveLength(1);
  });

  it('writes host files only after the artifact commits', async () => {
    const job = await runningJob();
    let committed = false;

    const write = vi
      .spyOn(hostFiles, 'writeArtifactHostFiles')
      .mockImplementation(async () => {
        committed = (await rowOf(job))?.artifactId != null;

        return '/tmp/job-artifact';
      });

    await settle(
      job,
      'x'.repeat(3000),
      { state: 'succeeded' },
      { hostFilesOn: true },
    );

    expect(write).toHaveBeenCalledTimes(1);
    expect(committed).toBe(true);
  });

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
