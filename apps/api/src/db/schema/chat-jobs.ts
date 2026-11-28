import { InferSelectModel, sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';
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

/** The delivery mode is committed with the binding and before promotion. */
export const chatJobDeliveries = ['foreground', 'background'] as const;

export type ChatJobDelivery = (typeof chatJobDeliveries)[number];

/** The exit detail of a settled job and its daemon-side unknown-outcome cause. */
export type ChatJobResult = {
  exitCode?: number | null;
  signal?: string | null;
  truncated?: Partial<Record<string, boolean>>;
  outcomeUnknown?: boolean;
  outputUnavailable?: boolean;
  cause?: string;
};

/**
 * One job on a Machine daemon. A job belongs to its Chat and owner, not to
 * the Run that started it, so `run_id` carries no foreign key. `seq` is
 * reserved with `chats.artifact_seq`, so `job://bash-7` and `artifact://bash-7`
 * name one thing. `daemon_job_id` identifies the daemon-side process.
 */
export const chatJobs = pgTable(
  'chat_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    kind: text('kind').notNull(),
    seq: integer('seq').notNull(),
    state: text('state').notNull().default('running').$type<ChatJobState>(),
    stoppedBy: text('stopped_by').$type<ChatJobStopper>(),
    runId: uuid('run_id').notNull(),
    toolCallId: text('tool_call_id').notNull(),
    /**
     * The intent the model gave the call that started the job, shown to the
     * owner as the job's name; null when the call carried none. Display only:
     * never part of the command, its admission, or the job's identity.
     */
    intent: text('intent'),
    /**
     * The shell text the job runs, as the call submitted it, so the owner can
     * see what a job did. Null for a job recorded before this column existed.
     */
    command: text('command'),
    machineName: text('machine_name').notNull(),
    daemonInstanceId: text('daemon_instance_id').notNull(),
    daemonJobId: text('daemon_job_id').notNull(),
    delivery: text('delivery')
      .notNull()
      .default('background')
      .$type<ChatJobDelivery>(),
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
    /** Selector, effort, and permission mode of the Run that started the job. */
    settings: jsonb('settings').$type<ChatDeliverySettings>().notNull(),
  },
  (t) => [
    // The owner must be the Chat's owner, as `runs_chat_id_user_id_fk` does.
    foreignKey({
      name: 'chat_jobs_chat_id_owner_user_id_fk',
      columns: [t.chatId, t.ownerUserId],
      foreignColumns: [chats.id, chats.ownerUserId],
    }).onDelete('cascade'),
    unique('chat_jobs_chat_kind_seq_unique').on(t.chatId, t.kind, t.seq),
    unique('chat_jobs_daemon_instance_job_unique').on(
      t.daemonInstanceId,
      t.daemonJobId,
    ),
    unique('chat_jobs_id_owner_unique').on(t.id, t.ownerUserId),
    index('chat_jobs_chat_running_idx')
      .on(t.chatId)
      .where(sql`state = 'running'`),
    pgPolicy('chat_jobs_owner', {
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();
// Drizzle does not emit FORCE ROW LEVEL SECURITY. Restore it in migrations.

export type ChatJob = InferSelectModel<typeof chatJobs>;

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
