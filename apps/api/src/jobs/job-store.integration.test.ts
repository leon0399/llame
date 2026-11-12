import type { RunWaitService } from '../runs/run-wait.service';
/**
 * The job store on a live database (background-jobs, job-store layer): the
 * three tables and their policies, first-writer-wins settlement, the dead-worker
 * touch and count, the reserved artifact number, the `job://` reader, and the
 * negative isolation cases.
 *
 * Requires TEST_DATABASE_URL (throws without it); run by test:integration.
 */

import { eq, sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { type ToolResult } from '@workspace/runtime-safety';
import { renderReadText } from '@workspace/native-file-tools';

import { ChatsRepository } from '../chats/chats-repository';
import { ChatsService } from '../chats/chats.service';
import {
  chatDeliveries,
  chatJobChunks,
  chatJobs,
  chats,
  runs,
  toolArtifacts,
  workerInstances,
} from '../db/schema';
import * as schema from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { newChatJob } from '../testing/chat-job-rows';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { readArtifact } from '../tools/artifacts/artifact-reader';
import {
  commitArtifactInTransaction,
  reserveArtifactSeq,
} from '../tools/artifacts/artifact-writer';
import { nativeReadTool, nativeWriteTool } from '../tools/native-files';
import { type ToolContext } from '../tools/types';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { ChatJobsRepository, type NewChatJob } from './chat-jobs.repository';
import { formatJobLocator, jobArtifactLocatorOf } from './job-locator';
import { readJob } from './job-reader';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { type WorkerConcurrencyResolver } from '../instance-config/worker-profile.service';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { workerDeadAfterSeconds } from './worker-liveness';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const MAX_BYTES = 1_048_576;
const DEAD_AFTER = workerDeadAfterSeconds(BUILT_IN_DEFAULTS);

describe('job store', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  let owner: string;
  let stranger: string;
  let chatId: string;
  let otherChatId: string;
  let strangerChatId: string;
  let liveWorker: string;
  let deadWorker: string;

  beforeAll(async () => {
    if (!TEST_DB_URL)
      throw new Error(
        'Integration database was not provisioned; run pnpm --filter api test:integration.',
      );
    sql = postgres(TEST_DB_URL, {
      ssl: /sslmode=require/.test(TEST_DB_URL) ? 'require' : false,
      max: 6,
    });
    tenantDb = new TenantDbService(drizzle(sql, { schema }));
    owner = crypto.randomUUID();
    stranger = crypto.randomUUID();

    for (const id of [owner, stranger]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'A', ${`j-${id}@t.com`})`;
    }

    chatId = await createChat(owner, 'Main');
    otherChatId = await createChat(owner, 'Other');
    strangerChatId = await createChat(stranger, 'Stranger');
    liveWorker = crypto.randomUUID();
    deadWorker = crypto.randomUUID();
    await sql`INSERT INTO worker_instances (id) VALUES (${liveWorker})`;

    await sql`INSERT INTO worker_instances (id, last_seen_at)
      VALUES (${deadWorker}, now() - make_interval(secs => ${DEAD_AFTER + 5}))`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${owner}, ${stranger})`;
      await sql`DELETE FROM worker_instances WHERE id IN (${liveWorker}, ${deadWorker})`;
      await sql.end();
    }
  });

  const context = (chat: string, user = owner): ToolContext => ({
    configuredCredentials: [],
    userId: user,
    chatId: chat,
    tenantDb,
    permissionPolicy: compileTestPermissionPolicy(),
  });

  /** A fresh Chat, so a test's numbers and rows stay its own. */
  async function freshChat(user = owner): Promise<string> {
    return createChat(user, 'Fresh');
  }

  async function createChat(user: string, title: string): Promise<string> {
    const chat = await tenantDb.runAs(user, (tx) =>
      new ChatsRepository(tx).create({ ownerUserId: user, title }),
    );

    return chat.id;
  }

  const withJobs = <T>(
    user: string,
    fn: (jobs: ChatJobsRepository) => Promise<T>,
  ) => tenantDb.runAs(user, (tx) => fn(new ChatJobsRepository(tx)));

  async function startJob(
    chat: string,
    seq: number,
    overrides: Partial<NewChatJob> = {},
  ) {
    return withJobs(owner, (jobs) =>
      jobs.insert(
        newChatJob({
          chatId: chat,
          ownerUserId: owner,
          seq,
          workerInstanceId: liveWorker,
          ...overrides,
        }),
      ),
    );
  }

  async function storeOutput(
    jobId: string,
    output: string,
    text: string,
    position = 0,
  ) {
    await tenantDb.runAs(owner, (tx) =>
      tx.insert(chatJobChunks).values({
        jobId,
        ownerUserId: owner,
        output,
        position,
        content: Buffer.from(text),
      }),
    );
  }

  describe('bounded output tails', () => {
    it('reads only the last byte window from a large output chunk', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 1);
      const text = `${'x'.repeat(7999)}🙂${'y'.repeat(7997)}`;
      await storeOutput(job.id, 'stdout', text);

      await expect(
        withJobs(owner, (jobs) =>
          jobs.readOutputTail(owner, job.id, 'stdout', 8000),
        ),
      ).resolves.toEqual(Buffer.from(text).subarray(-8000));
    });

    it('bounds across ordered chunks, including a multibyte boundary', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 1);
      const first = 'a'.repeat(7999);
      const second = `🙂${'b'.repeat(7997)}`;
      await storeOutput(job.id, 'stdout', first, 0);
      await storeOutput(job.id, 'stdout', second, 1);

      await expect(
        withJobs(owner, (jobs) =>
          jobs.readOutputTail(owner, job.id, 'stdout', 8000),
        ),
      ).resolves.toEqual(
        Buffer.concat([Buffer.from(first), Buffer.from(second)]).subarray(
          -8000,
        ),
      );
    });

    it('keeps the full tail across more than 8000 one-byte chunks', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 1);

      const chunks = Array.from({ length: 8005 }, (_unused, position) => ({
        jobId: job.id,
        ownerUserId: owner,
        output: 'stdout',
        position,
        content: Buffer.from(String.fromCharCode(65 + (position % 26))),
      }));

      await tenantDb.runAs(owner, (tx) =>
        tx.insert(chatJobChunks).values([
          ...chunks,
          {
            jobId: job.id,
            ownerUserId: owner,
            output: 'stdout',
            position: 8005,
            content: Buffer.alloc(0),
          },
        ]),
      );

      const expected = Buffer.concat(
        chunks.slice(-8000).map((chunk) => chunk.content),
      );

      await expect(
        withJobs(owner, (jobs) =>
          jobs.readOutputTail(owner, job.id, 'stdout', 8000),
        ),
      ).resolves.toEqual(expected);
    });
    it('returns short and empty outputs and hides wrong-owner or missing jobs', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 1);
      await storeOutput(job.id, 'short', 'é🙂');
      await storeOutput(job.id, 'empty', '');

      await expect(
        withJobs(owner, (jobs) =>
          jobs.readOutputTail(owner, job.id, 'short', 8000),
        ),
      ).resolves.toEqual(Buffer.from('é🙂'));
      await expect(
        withJobs(owner, (jobs) =>
          jobs.readOutputTail(owner, job.id, 'empty', 8000),
        ),
      ).resolves.toEqual(Buffer.alloc(0));
      await expect(
        withJobs(stranger, (jobs) =>
          jobs.readOutputTail(owner, job.id, 'short', 8000),
        ),
      ).resolves.toEqual(Buffer.alloc(0));
      await expect(
        withJobs(owner, (jobs) =>
          jobs.readOutputTail(owner, crypto.randomUUID(), 'short', 8000),
        ),
      ).resolves.toEqual(Buffer.alloc(0));
    });

    it('reads bounded artifact tails and hides other Chats and owners', async () => {
      const chat = await freshChat();

      const seq = await reserveArtifactSeq(tenantDb, {
        chatId: chat,
        userId: owner,
      });

      const job = await startJob(chat, seq);
      const text = `${'z'.repeat(9000)}${'é🙂'.repeat(20)}`;
      await tenantDb.runAs(owner, async (tx) => {
        await commitArtifactInTransaction(
          tx,
          {
            chatId: chat,
            userId: owner,
            runId: job.runId,
            toolCallId: job.toolCallId,
            toolName: job.executor,
            complete: true,
            parts: [
              {
                name: 'stdout',
                contentType: 'text/plain',
                content: Buffer.from(text),
              },
              {
                name: 'stderr',
                contentType: 'text/plain',
                content: Buffer.from('é🙂'),
              },
            ],
          },
          seq,
          MAX_BYTES,
        );
      });
      const locator = { toolName: job.executor, seq, part: 'stdout' };

      await expect(
        tenantDb.runAs(owner, (tx) =>
          new ArtifactsRepository(tx).readPartTail(chat, locator, 8000),
        ),
      ).resolves.toEqual(Buffer.from(text).subarray(-8000));
      await expect(
        tenantDb.runAs(owner, (tx) =>
          new ArtifactsRepository(tx).readPartTail(
            chat,
            { ...locator, part: 'stderr' },
            8000,
          ),
        ),
      ).resolves.toEqual(Buffer.from('é🙂'));
      await expect(
        tenantDb.runAs(owner, (tx) =>
          new ArtifactsRepository(tx).readPartTail(otherChatId, locator, 8000),
        ),
      ).resolves.toBeUndefined();
      await expect(
        tenantDb.runAs(stranger, (tx) =>
          new ArtifactsRepository(tx).readPartTail(chat, locator, 8000),
        ),
      ).resolves.toBeUndefined();
      await expect(
        tenantDb.runAs(owner, (tx) =>
          new ArtifactsRepository(tx).readPartTail(
            chat,
            { ...locator, part: 'missing' },
            8000,
          ),
        ),
      ).resolves.toBeUndefined();
    });
  });

  const textOf = (result: ToolResult): string => {
    if (result.status !== 'success') {
      throw new Error(`Expected a success, got ${JSON.stringify(result)}`);
    }

    return renderReadText(result);
  };

  it('has forced owner RLS on the job tables and none on the worker table', async () => {
    const tables = await sql`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      WHERE c.relname IN ('chat_jobs', 'chat_job_chunks', 'worker_instances')
      ORDER BY c.relname
    `;

    expect(tables).toEqual([
      {
        relname: 'chat_job_chunks',
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
      { relname: 'chat_jobs', relrowsecurity: true, relforcerowsecurity: true },
      {
        relname: 'worker_instances',
        relrowsecurity: false,
        relforcerowsecurity: false,
      },
    ]);
  });

  describe('settlement', () => {
    // Scenario: A late stop does not change a settled job
    it('keeps a succeeded job and its result when a stop arrives late', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 1);

      await withJobs(owner, (jobs) =>
        jobs.settle(chat, owner, job.id, {
          state: 'succeeded',
          result: { exitCode: 0 },
        }),
      );

      const stopped = await withJobs(owner, (jobs) =>
        jobs.requestStop(chat, owner, job.id, 'owner'),
      );

      expect(stopped).toBeUndefined();

      const [after] = await withJobs(owner, (jobs) =>
        jobs.listByChat(chat, owner),
      );

      expect(after).toMatchObject({
        state: 'succeeded',
        result: { exitCode: 0 },
        stopRequestedAt: null,
        stopRequestedBy: null,
        stoppedBy: null,
      });
    });

    // Scenario: A settlement is recorded twice (one settled state)
    it('settles once when two writers race', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 1);

      const outcomes = await Promise.all([
        withJobs(owner, (jobs) =>
          jobs.settle(chat, owner, job.id, {
            state: 'succeeded',
            result: { exitCode: 0 },
          }),
        ),
        withJobs(owner, (jobs) =>
          jobs.settle(chat, owner, job.id, {
            state: 'failed',
            result: { exitCode: 2 },
          }),
        ),
      ]);

      const winners = outcomes.filter((outcome) => outcome !== undefined);

      expect(winners).toHaveLength(1);

      const [after] = await withJobs(owner, (jobs) =>
        jobs.listByChat(chat, owner),
      );

      expect(after.state).toBe(winners[0]?.state);
      expect(after.result).toEqual(winners[0]?.result);
      expect(after.settledAt).not.toBeNull();

      // A third writer after the fact changes nothing either.
      const late = await withJobs(owner, (jobs) =>
        jobs.settle(chat, owner, job.id, { state: 'timed_out' }),
      );

      expect(late).toBeUndefined();
    });

    it('records the stopper of a cancelled job and keeps the first stop request', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 1);

      await withJobs(owner, (jobs) =>
        jobs.requestStop(chat, owner, job.id, 'owner'),
      );

      const again = await withJobs(owner, (jobs) =>
        jobs.requestStop(chat, owner, job.id, 'assistant'),
      );

      expect(again).toMatchObject({
        state: 'running',
        stopRequestedBy: 'owner',
      });

      const cancelled = await withJobs(owner, (jobs) =>
        jobs.settle(chat, owner, job.id, {
          state: 'cancelled',
          stoppedBy: 'owner',
        }),
      );

      expect(cancelled).toMatchObject({
        state: 'cancelled',
        stoppedBy: 'owner',
      });
    });
  });

  describe('a dead worker', () => {
    // Scenario: A crash is found at the next message
    it('settles the running jobs of a worker with a stale heartbeat as lost', async () => {
      const chat = await freshChat();
      const crashed = await startJob(chat, 1, { workerInstanceId: deadWorker });
      const healthy = await startJob(chat, 2);

      const settled = await withJobs(owner, (jobs) =>
        jobs.settleOnDeadWorkers(chat, owner, DEAD_AFTER),
      );

      expect(settled.map((job) => job.id)).toEqual([crashed.id]);
      expect(settled[0]).toMatchObject({
        state: 'lost',
        result: { outcomeUnknown: true },
      });

      const rows = await withJobs(owner, (jobs) =>
        jobs.listByChat(chat, owner),
      );

      expect(rows.find((job) => job.id === healthy.id)?.state).toBe('running');

      expect(
        await withJobs(owner, (jobs) =>
          jobs.settleOnDeadWorkers(chat, owner, DEAD_AFTER),
        ),
      ).toEqual([]);

      const notices = await tenantDb.runAs(owner, (tx) =>
        tx
          .select()
          .from(chatDeliveries)
          .where(eq(chatDeliveries.senderRef, crashed.id)),
      );

      const runsInChat = await tenantDb.runAs(owner, (tx) =>
        tx.select().from(runs).where(eq(runs.chatId, chat)),
      );

      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        chatId: chat,
        ownerUserId: owner,
        producer: 'job',
        senderRef: crashed.id,
        mode: 'notice',
        state: 'pending',
      });
      expect(runsInChat).toEqual([]);
    });

    it('treats a worker with no row as dead', async () => {
      const chat = await freshChat();

      await startJob(chat, 1, { workerInstanceId: crypto.randomUUID() });

      const settled = await withJobs(owner, (jobs) =>
        jobs.settleOnDeadWorkers(chat, owner, DEAD_AFTER),
      );

      expect(settled).toHaveLength(1);
    });

    it('never scans another Chat', async () => {
      const chat = await freshChat();
      const other = await freshChat();

      await startJob(chat, 1, { workerInstanceId: deadWorker });
      await startJob(other, 1, { workerInstanceId: deadWorker });
      await withJobs(owner, (jobs) =>
        jobs.settleOnDeadWorkers(chat, owner, DEAD_AFTER),
      );

      const [otherJob] = await withJobs(owner, (jobs) =>
        jobs.listByChat(other, owner),
      );

      expect(otherJob.state).toBe('running');
    });

    // Scenario: A job on a dead worker is not counted
    it('counts only the running jobs on a worker that is not dead', async () => {
      const chat = await freshChat();

      await startJob(chat, 1);
      await startJob(chat, 2, { workerInstanceId: deadWorker });

      const settledJob = await startJob(chat, 3);

      await withJobs(owner, (jobs) =>
        jobs.settle(chat, owner, settledJob.id, { state: 'succeeded' }),
      );

      const counts = await withJobs(owner, (jobs) =>
        jobs.countRunning(owner, DEAD_AFTER),
      );

      expect(counts.get(chat)).toBe(1);

      const onlyDead = await freshChat();

      await startJob(onlyDead, 1, { workerInstanceId: deadWorker });

      const narrowed = await withJobs(owner, (jobs) =>
        jobs.countRunning(owner, DEAD_AFTER, onlyDead),
      );

      expect(narrowed.get(onlyDead)).toBe(0);

      // The count settles nothing.
      const [still] = await withJobs(owner, (jobs) =>
        jobs.listByChat(onlyDead, owner),
      );

      expect(still.state).toBe('running');
    });

    it('retains zero groups for missing workers and omits Chats without running rows', async () => {
      const missingWorkerChat = await freshChat();
      const settledChat = await freshChat();
      const emptyChat = await freshChat();

      await startJob(missingWorkerChat, 1, {
        workerInstanceId: crypto.randomUUID(),
      });
      const settled = await startJob(settledChat, 1);

      await withJobs(owner, (jobs) =>
        jobs.settle(settledChat, owner, settled.id, { state: 'succeeded' }),
      );

      const counts = await withJobs(owner, (jobs) =>
        jobs.countRunning(owner, DEAD_AFTER),
      );

      expect(counts.get(missingWorkerChat)).toBe(0);
      expect(counts.has(settledChat)).toBe(false);
      expect(counts.has(emptyChat)).toBe(false);
    });

    // Scenario: A lost job keeps its stored output
    it('keeps the stored output of a lost job readable', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 1, { workerInstanceId: deadWorker });

      const lines = Array.from(
        { length: 40 },
        (_unused, index) => `line ${index + 1}`,
      );

      await storeOutput(
        job.id,
        'stdout',
        lines.slice(0, 20).join('\n') + '\n',
        0,
      );
      await storeOutput(job.id, 'stdout', lines.slice(20).join('\n') + '\n', 1);

      // The read is the touch: it settles the job, then returns the output.
      const result = await readJob(
        context(chat),
        'read',
        'job://bash-1/stdout',
      );

      expect(textOf(result)).toContain('line 1\n');
      expect(textOf(result)).toContain('line 40');

      const [after] = await withJobs(owner, (jobs) =>
        jobs.listByChat(chat, owner),
      );

      expect(after).toMatchObject({
        state: 'lost',
        result: { outcomeUnknown: true },
      });
    });
  });

  describe('the worker heartbeat', () => {
    const profile = (
      concurrency: number | null,
    ): WorkerConcurrencyResolver => ({
      concurrencyFor: () => concurrency,
    });

    const config: InstanceConfigReader = { config: BUILT_IN_DEFAULTS };

    it('takes a new identity at each start and upserts its row', async () => {
      const db = drizzle(sql, { schema });
      const first = new WorkerHeartbeatService(db, config, profile(1));
      const second = new WorkerHeartbeatService(db, config, profile(1));

      expect(first.instanceId).not.toBe(second.instanceId);

      try {
        await first.onModuleInit();
        await sql`UPDATE worker_instances SET last_seen_at = now() - interval '1 hour' WHERE id = ${first.instanceId}`;
        await first.beat();

        const [row] = await db
          .select()
          .from(workerInstances)
          .where(eq(workerInstances.id, first.instanceId));

        expect(Date.now() - row.lastSeenAt.getTime()).toBeLessThan(60_000);
        await expect(
          db
            .select()
            .from(workerInstances)
            .where(eq(workerInstances.id, second.instanceId)),
        ).resolves.toEqual([]);
      } finally {
        first.onModuleDestroy();
        await sql`DELETE FROM worker_instances WHERE id = ${first.instanceId}`;
      }
    });

    it('records no heartbeat in a process that does not consume runs', async () => {
      const db = drizzle(sql, { schema });
      const service = new WorkerHeartbeatService(db, config, profile(null));

      await service.onModuleInit();
      service.onModuleDestroy();

      await expect(
        db
          .select()
          .from(workerInstances)
          .where(eq(workerInstances.id, service.instanceId)),
      ).resolves.toEqual([]);
    });
  });

  describe('the reserved artifact number', () => {
    // Scenario: The job and its artifact share a number
    it('gives the job and its artifact one number, written in one transaction', async () => {
      const chat = await freshChat();

      const seq = await reserveArtifactSeq(tenantDb, {
        chatId: chat,
        userId: owner,
      });

      const job = await startJob(chat, seq, { toolCallId: 'call-bg' });
      const runId = job.runId;

      const settled = await tenantDb.runAs(owner, async (tx) => {
        const artifact = await commitArtifactInTransaction(
          tx,
          {
            chatId: chat,
            userId: owner,
            runId,
            toolCallId: 'call-bg',
            toolName: 'bash',
            complete: true,
            parts: [
              {
                name: 'stdout',
                contentType: 'text/plain',
                content: Buffer.from('x'.repeat(50_000)),
              },
              {
                name: 'stderr',
                contentType: 'text/plain',
                content: Buffer.from(''),
              },
            ],
          },
          seq,
          MAX_BYTES,
        );

        return new ChatJobsRepository(tx).settle(chat, owner, job.id, {
          state: 'failed',
          result: { exitCode: 2 },
          artifactId: artifact.id,
        });
      });

      expect(settled).toBeDefined();
      expect(formatJobLocator(settled!.executor, settled!.seq)).toBe(
        `job://bash-${seq}`,
      );
      expect(jobArtifactLocatorOf(settled!)).toBe(`artifact://bash-${seq}`);

      const read = await readArtifact(
        context(chat),
        'read',
        `artifact://bash-${seq}/stdout:1`,
      );

      expect(read.status).toBe('success');
    });

    it('commits nothing of the artifact when the transaction fails', async () => {
      const chat = await freshChat();

      const seq = await reserveArtifactSeq(tenantDb, {
        chatId: chat,
        userId: owner,
      });

      const job = await startJob(chat, seq);

      await expect(
        tenantDb.runAs(owner, async (tx) => {
          await commitArtifactInTransaction(
            tx,
            {
              chatId: chat,
              userId: owner,
              runId: job.runId,
              toolCallId: 'call-x',
              toolName: 'bash',
              complete: true,
              parts: [
                {
                  name: 'stdout',
                  contentType: 'text/plain',
                  content: Buffer.from('a'),
                },
              ],
            },
            seq,
            MAX_BYTES,
          );

          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');

      const rows = await tenantDb.runAs(owner, (tx) =>
        tx.select().from(toolArtifacts).where(eq(toolArtifacts.chatId, chat)),
      );

      expect(rows).toEqual([]);
    });

    it('refuses a part over the bound before it writes a row', async () => {
      const chat = await freshChat();

      await expect(
        tenantDb.runAs(owner, (tx) =>
          commitArtifactInTransaction(
            tx,
            {
              chatId: chat,
              userId: owner,
              runId: crypto.randomUUID(),
              toolCallId: 'call-y',
              toolName: 'bash',
              complete: true,
              parts: [
                {
                  name: 'stdout',
                  contentType: 'text/plain',
                  content: Buffer.alloc(10),
                },
              ],
            },
            1,
            5,
          ),
        ),
      ).rejects.toThrow('exceeds tools.artifacts.maxBytes');
    });
  });

  describe('the job:// reader', () => {
    // Scenario: A record of a live job
    it('returns the record of a live job without any output content', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 4);

      await storeOutput(job.id, 'stdout', 'secret progress\n');

      const result = await readJob(context(chat), 'read', 'job://bash-4');
      const text = textOf(result);

      // Scenario: A job record is plain text
      expect(text.split('\n')[0]).toBe('job://bash-4');
      expect(text).toContain('\nstate: running\n');
      expect(text).toContain('\nelapsed: ');
      expect(text).toContain('\noutputs: stdout, stderr');
      expect(text).not.toContain('secret progress');
    });

    // Scenario: A record of a failed job
    it('returns the exit code and the artifact locator of a failed job', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 4);

      const artifactId = await tenantDb.runAs(owner, async (tx) => {
        const artifact = await commitArtifactInTransaction(
          tx,
          {
            chatId: chat,
            userId: owner,
            runId: job.runId,
            toolCallId: 'call-4',
            toolName: 'bash',
            complete: true,
            parts: [
              {
                name: 'stdout',
                contentType: 'text/plain',
                content: Buffer.from('y'.repeat(50_000)),
              },
              {
                name: 'stderr',
                contentType: 'text/plain',
                content: Buffer.from(''),
              },
            ],
          },
          4,
          MAX_BYTES,
        );

        await new ChatJobsRepository(tx).settle(chat, owner, job.id, {
          state: 'failed',
          result: { exitCode: 2 },
          artifactId: artifact.id,
        });

        return artifact.id;
      });

      expect(artifactId).toBeDefined();

      const text = textOf(await readJob(context(chat), 'read', 'job://bash-4'));

      expect(text).toContain('state: failed');
      expect(text).toContain('exit_code: 2');
      expect(text).toContain('artifact: artifact://bash-4');
      expect(text).not.toContain('yyyy');

      // The output comes from the artifact once the chunks are gone.
      const output = textOf(
        await readJob(context(chat), 'read', 'job://bash-4/stdout:1'),
      );

      expect(output.startsWith('job://bash-4/stdout:1')).toBe(true);
      expect(output).toContain('yyyy');
    });

    // Scenario: The tail of a live output
    it('returns the last stored lines of a live output', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 4);

      const lines = Array.from(
        { length: 120 },
        (_unused, index) => `row ${index + 1}`,
      );

      await storeOutput(
        job.id,
        'stdout',
        lines.slice(0, 60).join('\n') + '\n',
        0,
      );
      await storeOutput(job.id, 'stdout', lines.slice(60).join('\n') + '\n', 1);

      const text = textOf(
        await readJob(context(chat), 'read', 'job://bash-4/stdout:-50'),
      );

      expect(text).toContain('row 120');
      expect(text).toContain('row 71');
      expect(text).not.toContain(': row 20\n');
    });

    // Scenario: A job output read has the read header
    it('opens an output read with the read header', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 4);

      await storeOutput(
        job.id,
        'stdout',
        Array.from({ length: 40 }, (_unused, index) => `l${index + 1}\n`).join(
          '',
        ),
      );

      const text = textOf(
        await readJob(context(chat), 'read', 'job://bash-4/stdout:1-3'),
      );

      // The shared text read grows the window by a context line, so the header
      // names the shown range of the same locator.
      expect(text.split('\n')[0]).toBe('job://bash-4/stdout:1-4 of 40 lines');
      expect(text).toContain('1: l1\n');
    });

    it('reads a quiet output as empty', async () => {
      const chat = await freshChat();

      await startJob(chat, 4);

      const text = textOf(
        await readJob(context(chat), 'read', 'job://bash-4/stderr'),
      );

      expect(text.split('\n')[0]).toBe('job://bash-4/stderr: empty');
    });

    // Scenario: An unknown output
    it('answers not_found for an unknown output', async () => {
      const chat = await freshChat();

      await startJob(chat, 4);

      await expect(
        readJob(context(chat), 'read', 'job://bash-4/log'),
      ).resolves.toMatchObject({
        status: 'error',
        type: 'not_found',
      });
    });

    // Scenario: A locator of another Chat does not resolve
    it('answers not_found for a job of another Chat of the same owner', async () => {
      const chatA = await freshChat();
      const chatB = await freshChat();

      await startJob(chatA, 7);

      await expect(
        readJob(context(chatB), 'read', 'job://bash-7'),
      ).resolves.toMatchObject({
        status: 'error',
        type: 'not_found',
      });
      await expect(
        readJob(context(chatB), 'read', 'job://bash-7/stdout'),
      ).resolves.toMatchObject({ status: 'error', type: 'not_found' });
    });

    // Scenario: A list of two jobs
    it('lists the jobs of the Chat with the oldest first', async () => {
      const chat = await freshChat();

      await startJob(chat, 4, {
        startedAt: new Date('2026-11-11T10:00:00.000Z'),
      });

      const done = await startJob(chat, 2, {
        startedAt: new Date('2026-11-11T09:00:00.000Z'),
      });

      await withJobs(owner, (jobs) =>
        jobs.settle(chat, owner, done.id, { state: 'succeeded' }),
      );

      const text = textOf(await readJob(context(chat), 'read', 'job://'));
      const lines = text.trimEnd().split('\n');

      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe('job://');
      expect(lines[1]).toBe(
        'job://bash-2 (succeeded, 2026-11-11T09:00:00.000Z)',
      );
      expect(lines[2]).toBe('job://bash-4 (running, 2026-11-11T10:00:00.000Z)');
    });

    it('lists an empty Chat as empty and accepts one line range', async () => {
      const chat = await freshChat();

      expect(textOf(await readJob(context(chat), 'read', 'job://'))).toBe(
        'job://: empty',
      );

      await startJob(chat, 1);
      await startJob(chat, 2);

      const ranged = textOf(await readJob(context(chat), 'read', 'job://:2-2'));

      expect(ranged.split('\n')).toHaveLength(2);
    });

    // Scenario: A fork during a live job
    it('lists no job in a fork of a Chat with a live job', async () => {
      const live = await freshChat();

      await startJob(live, 4);

      const fork = await new ChatsService(
        tenantDb,
        noopReindexDispatch(),
        noopEmbedDispatch(),
        noopQueryEmbedder(),
        { wakeInTransaction: () => Promise.resolve(false) } satisfies Pick<
          RunWaitService,
          'wakeInTransaction'
        >,
      ).forkChat(live, owner);

      expect(fork.id).not.toBe(live);

      expect(textOf(await readJob(context(fork.id), 'read', 'job://'))).toBe(
        'job://: empty',
      );

      expect(textOf(await readJob(context(live), 'read', 'job://'))).toContain(
        'job://bash-4 (running',
      );
    });

    // Scenario: A write is refused
    it('refuses edit and write and leaves the job unchanged', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 4);

      for (const operation of ['edit', 'write'] as const) {
        await expect(
          readJob(context(chat), operation, 'job://bash-4/stdout'),
        ).resolves.toMatchObject({ status: 'error', type: 'invalid_path' });
      }

      const written = await nativeWriteTool.execute(context(chat), {
        path: 'job://bash-4/stdout',
        content: 'x',
      });

      expect(written).toMatchObject({ status: 'error', type: 'invalid_path' });

      const [after] = await withJobs(owner, (jobs) =>
        jobs.listByChat(chat, owner),
      );

      expect(after).toMatchObject({ id: job.id, state: 'running' });
    });

    it('refuses a malformed locator', async () => {
      const chat = await freshChat();

      for (const path of ['job://bash', 'job://bash-0', 'job://bash-1/a/b']) {
        await expect(
          readJob(context(chat), 'read', path),
        ).resolves.toMatchObject({
          status: 'error',
          type: 'invalid_path',
        });
      }
    });

    it('reads an upper-case scheme as the same locator', async () => {
      const chat = await freshChat();

      await startJob(chat, 4);

      const text = textOf(await readJob(context(chat), 'read', 'JOB://bash-4'));

      expect(text.split('\n')[0]).toBe('job://bash-4');
    });
  });

  describe('isolation', () => {
    // Scenario: A query without an identity finds no job
    it('finds no job in a query that carries no owner identity', async () => {
      const chat = await freshChat();

      await startJob(chat, 1);

      const unscoped =
        await sql`SELECT id FROM chat_jobs WHERE chat_id = ${chat}`;

      expect(unscoped).toHaveLength(0);

      const publicRows = await tenantDb.runAsPublic((tx) =>
        tx.select().from(chatJobs).where(eq(chatJobs.chatId, chat)),
      );

      expect(publicRows).toEqual([]);
    });

    // Scenario: A query without an identity finds no stored output
    it('finds no stored output in a query that carries no owner identity', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 1);

      await storeOutput(job.id, 'stdout', 'kept\n');

      const unscoped =
        await sql`SELECT job_id FROM chat_job_chunks WHERE job_id = ${job.id}`;

      expect(unscoped).toHaveLength(0);

      const publicRows = await tenantDb.runAsPublic((tx) =>
        tx.select().from(chatJobChunks).where(eq(chatJobChunks.jobId, job.id)),
      );

      expect(publicRows).toEqual([]);
    });

    it('hides a job, its output, and its stop from another owner', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 1);
      const crashed = await startJob(chat, 2, { workerInstanceId: deadWorker });

      await storeOutput(job.id, 'stdout', 'private\n');

      // The stranger names the owner and the owner's ids, so only the policy
      // can hide the rows.
      const seen = await withJobs(stranger, async (jobs) => ({
        byLocator: await jobs.findByLocator(chat, owner, 'bash', 1),
        byId: await jobs.findById(chat, owner, job.id),
        list: await jobs.listByChat(chat, owner),
        output: await jobs.readOutput(owner, job.id, 'stdout'),
        stop: await jobs.requestStop(chat, owner, job.id, 'owner'),
        settle: await jobs.settle(chat, owner, job.id, {
          state: 'succeeded',
        }),
        lost: await jobs.settleOnDeadWorkers(chat, owner, DEAD_AFTER),
        counts: await jobs.countRunning(owner, DEAD_AFTER),
      }));

      expect(seen.byLocator).toBeUndefined();
      expect(seen.byId).toBeUndefined();
      expect(seen.list).toEqual([]);
      expect(seen.output.byteLength).toBe(0);
      expect(seen.stop).toBeUndefined();
      expect(seen.settle).toBeUndefined();
      expect(seen.lost).toEqual([]);
      expect(seen.counts.size).toBe(0);

      const after = await withJobs(owner, (jobs) =>
        jobs.listByChat(chat, owner),
      );

      expect(after.map((row) => [row.id, row.state])).toEqual([
        [job.id, 'running'],
        [crashed.id, 'running'],
      ]);

      expect(after[0].stopRequestedAt).toBeNull();
    });

    it('refuses to store a job or a chunk under the wrong owner', async () => {
      const job = await startJob(await freshChat(), 1);

      // The stranger names the owner's Chat: the owner pair has no Chat row.
      await expect(
        tenantDb.runAs(stranger, (tx) =>
          new ChatJobsRepository(tx).insert(
            newChatJob({
              chatId,
              ownerUserId: stranger,
              seq: 99,
              workerInstanceId: liveWorker,
            }),
          ),
        ),
      ).rejects.toMatchObject({ cause: { code: '23503' } });

      // The stranger stamps the owner's identity on a row: the policy refuses.
      await expect(
        tenantDb.runAs(stranger, (tx) =>
          new ChatJobsRepository(tx).insert(
            newChatJob({
              chatId,
              ownerUserId: owner,
              seq: 98,
              workerInstanceId: liveWorker,
            }),
          ),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });

      await expect(
        tenantDb.runAs(stranger, (tx) =>
          tx.insert(chatJobChunks).values({
            jobId: job.id,
            ownerUserId: stranger,
            output: 'stdout',
            position: 0,
            content: Buffer.from('forged'),
          }),
        ),
      ).rejects.toMatchObject({ cause: { code: '23503' } });

      // The stranger stamps the owner's identity on a chunk of the owner's valid
      // job and owner pair: the FK holds, so only the policy refuses.
      await expect(
        tenantDb.runAs(stranger, (tx) =>
          tx.insert(chatJobChunks).values({
            jobId: job.id,
            ownerUserId: owner,
            output: 'stdout',
            position: 1,
            content: Buffer.from('forged'),
          }),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });

      // The same chunk written by its owner is accepted.
      await storeOutput(job.id, 'stdout', 'legit\n', 2);
      await expect(
        withJobs(owner, (jobs) => jobs.readOutput(owner, job.id, 'stdout')),
      ).resolves.toEqual(Buffer.from('legit\n'));
    });

    it('answers not_found to a foreign job:// read through the read tool', async () => {
      const job = await startJob(otherChatId, 31);

      await storeOutput(job.id, 'stdout', 'owner data\n');

      // The stranger names the owner's Chat: RLS hides the row.
      for (const path of ['job://bash-31', 'job://bash-31/stdout']) {
        const result = await nativeReadTool.execute(
          context(otherChatId, stranger),
          { path },
        );

        expect(result).toMatchObject({ status: 'error', type: 'not_found' });
      }

      // The stranger reads in a Chat of their own: the locator is another Chat's.
      const own = await nativeReadTool.execute(
        context(strangerChatId, stranger),
        {
          path: 'job://bash-31',
        },
      );

      expect(own).toMatchObject({ status: 'error', type: 'not_found' });

      const list = await nativeReadTool.execute(
        context(otherChatId, stranger),
        {
          path: 'job://',
        },
      );

      expect(textOf(list)).toBe('job://: empty');

      const [after] = await withJobs(owner, (jobs) =>
        jobs.listByChat(otherChatId, owner),
      );

      expect(after.state).toBe('running');
    });

    it('deletes the jobs and their output with the Chat', async () => {
      const chat = await freshChat();
      const job = await startJob(chat, 1);

      await storeOutput(job.id, 'stdout', 'gone\n');

      // Forced RLS hides every row from the unscoped client, so the owner's
      // own identity reads both tables.
      const count = () =>
        tenantDb.runAs(owner, async (tx) => ({
          jobs: (
            await tx.execute(
              drizzleSql`SELECT 1 FROM chat_jobs WHERE id = ${job.id}`,
            )
          ).length,
          chunks: (
            await tx.execute(
              drizzleSql`SELECT 1 FROM chat_job_chunks WHERE job_id = ${job.id}`,
            )
          ).length,
        }));

      expect(await count()).toEqual({ jobs: 1, chunks: 1 });

      await tenantDb.runAs(owner, (tx) =>
        tx.delete(chats).where(eq(chats.id, chat)),
      );

      expect(await count()).toEqual({ jobs: 0, chunks: 0 });
    });
  });
});
