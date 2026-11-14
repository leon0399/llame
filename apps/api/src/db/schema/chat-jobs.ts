import { InferSelectModel, sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { bytea, timestamptz } from '../columns';
import { type ChatDeliverySettings } from './chat-deliveries';
import { chats } from './chats';
import { toolArtifacts } from './tool-artifacts';

/** The states of a job; every state but `running` is settled (background-jobs). */
export const chatJobStates = [
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'lost',
] as const;

export type ChatJobState = (typeof chatJobStates)[number];

/** Who stopped a `cancelled` job. */
export const chatJobStoppers = ['owner', 'assistant', 'worker'] as const;

export type ChatJobStopper = (typeof chatJobStoppers)[number];

/** The exit detail of a settled job; a later layer adds the fields it fills. */
export type ChatJobResult = {
  exitCode?: number | null;
  signal?: string | null;
  truncated?: Partial<Record<string, boolean>>;
  /** Set on a `lost` job: the outcome of the work is not known. */
  outcomeUnknown?: boolean;
};

/**
 * One background job (background-jobs D1): work that continues after the tool
 * call that started it. A job belongs to its Chat and owner, not to the Run
 * that started it, so `run_id` carries no foreign key. `seq` is a number that
 * `chats.artifact_seq` reserved, so `job://bash-7` and `artifact://bash-7`
 * name one thing. `worker_instance_id` names the process that hosts the work;
 * it has no foreign key because a worker row can be pruned while the job row
 * stays.
 *
 * NOTE: `.enableRLS()` only emits ENABLE. The migration ALSO issues
 * `FORCE ROW LEVEL SECURITY` (src/db/AGENTS.md P1); re-add FORCE if it is
 * regenerated.
 */
export const chatJobs = pgTable(
  'chat_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    executor: text('executor').notNull(),
    seq: integer('seq').notNull(),
    state: text('state').notNull().default('running').$type<ChatJobState>(),
    stoppedBy: text('stopped_by').$type<ChatJobStopper>(),
    runId: uuid('run_id').notNull(),
    toolCallId: text('tool_call_id').notNull(),
    workerInstanceId: uuid('worker_instance_id').notNull(),
    pid: integer('pid'),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    settledAt: timestamptz('settled_at'),
    deadlineAt: timestamptz('deadline_at'),
    stopRequestedAt: timestamptz('stop_requested_at'),
    stopRequestedBy: text('stop_requested_by').$type<ChatJobStopper>(),
    result: jsonb('result').$type<ChatJobResult>(),
    outputs: text('outputs')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    artifactId: uuid('artifact_id').references(() => toolArtifacts.id, {
      onDelete: 'set null',
    }),
    artifactReadable: boolean('artifact_readable').notNull().default(false),
    /** Model, effort, and permission mode of the Run that started the job. */
    settings: jsonb('settings').$type<ChatDeliverySettings>().notNull(),
  },
  (t) => [
    // The owner must be the Chat's owner, as `runs_chat_id_user_id_fk` does.
    foreignKey({
      name: 'chat_jobs_chat_id_owner_user_id_fk',
      columns: [t.chatId, t.ownerUserId],
      foreignColumns: [chats.id, chats.ownerUserId],
    }).onDelete('cascade'),
    unique('chat_jobs_chat_executor_seq_unique').on(
      t.chatId,
      t.executor,
      t.seq,
    ),
    // The target of the chunk table's composite foreign key.
    unique('chat_jobs_id_owner_unique').on(t.id, t.ownerUserId),
    // The live count of one Chat.
    index('chat_jobs_chat_running_idx')
      .on(t.chatId)
      .where(sql`state = 'running'`),
    pgPolicy('chat_jobs_owner', {
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type ChatJob = InferSelectModel<typeof chatJobs>;

/**
 * One appended increment of a live job's output (background-jobs D1). The
 * composite foreign key keeps the owner of a chunk equal to the owner of its
 * job, so the owner policy needs no join.
 *
 * NOTE: `.enableRLS()` only emits ENABLE; the migration adds FORCE.
 */
export const chatJobChunks = pgTable(
  'chat_job_chunks',
  {
    jobId: uuid('job_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    /** The output name, such as `stdout`. */
    output: text('output').notNull(),
    position: integer('position').notNull(),
    content: bytea('content').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'chat_job_chunks_pk',
      columns: [t.jobId, t.output, t.position],
    }),
    foreignKey({
      name: 'chat_job_chunks_job_id_owner_user_id_fk',
      columns: [t.jobId, t.ownerUserId],
      foreignColumns: [chatJobs.id, chatJobs.ownerUserId],
    }).onDelete('cascade'),
    pgPolicy('chat_job_chunks_owner', {
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type ChatJobChunk = InferSelectModel<typeof chatJobChunks>;

/**
 * One worker process (background-jobs D9): a random id at each start and the
 * time of its last heartbeat. Instance-wide infrastructure with no tenant
 * column and NO RLS, as `embedding_model_bindings` is: it holds no tenant
 * data, and FORCE RLS on an owner-less table would hide it from the request
 * role.
 */
export const workerInstances = pgTable('worker_instances', {
  id: uuid('id').primaryKey(),
  lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
});

export type WorkerInstance = InferSelectModel<typeof workerInstances>;
