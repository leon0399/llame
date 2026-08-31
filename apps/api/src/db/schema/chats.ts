import { InferSelectModel } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';
import { sql } from 'drizzle-orm';
import { users } from './auth';
import { projects } from './projects';
import { modelContextSnapshots } from './model-context';

export type RecencyDigestEntry = {
  title: string;
  date: string;
  messageCount: number;
  excerpt?: string;
};

/** Frozen prompt inputs. Deliberately excludes chat identifiers. */
export type RecencyDigestBaseline = {
  pinned: Array<RecencyDigestEntry>;
  recent: Array<RecencyDigestEntry>;
  pinnedShown: number;
  pinnedTotal: number;
  recentShown: number;
  recentTotal: number;
  compiledOn: string;
};

/**
 * Internal event bookkeeping; this is never passed to prompt rendering.
 *
 * `title` is optional only while old JSONB rows from the baseline layer remain
 * readable. Their pin corrections fail closed instead of emitting anonymous
 * events, because the model cannot attribute one to a previously announced chat.
 */
export type RecencyDigestToldEntry = {
  chatId: string;
  pinned: boolean;
  title?: string;
};

// DB-enforced visibility values (not just a TS-level varchar union, which Postgres
// would not constrain).
export const chatVisibility = pgEnum('chat_visibility', ['private', 'public']);

// A conversation. `ownerUserId` is the tenant boundary for v0.1.
// (Org-owned chats add a nullable `orgId` in v0.3 — additive, not a retrofit.)
//
// NOTE: ownerUserId uses `text` (not `uuid`) because it references `users.id`
// which is a `text` column (NextAuth adapter convention). chats.id itself uses
// `uuid` since it is a new table with no legacy constraint.
export const chats = pgTable(
  'chats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // text — FK to users.id which is text (NextAuth convention)
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Nullable: NULL = untitled (awaiting server-side generation, #78). Clients render
    // their own localized placeholder for NULL — the DB never stores a display literal,
    // so "untitled" state survives i18n and can't collide with a user naming a chat
    // whatever the placeholder text happens to be. Any non-NULL title (generated or
    // manual) is never auto-replaced: setGeneratedTitle guards on `title IS NULL`.
    title: text('title'),
    visibility: chatVisibility('visibility').notNull().default('private'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    // Archive state (chat-project-archive): a nullable timestamp on the row, so
    // archiving is a global, owner-scoped action (unlike the per-user `pins`
    // table). NULL = not archived. Honor it in list reads (exclude by default)
    // and the mutation guard (archived rejects all writes except unarchive/delete).
    archivedAt: timestamptz('archived_at'),
    // Folder grouping (projects-foundation): a chat belongs to 0-or-1 project.
    // ON DELETE SET NULL — deleting a project unfiles its chats, never destroys them.
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    // NULL means this chat has never entered a sharing epoch. No backfill: old
    // chats must not disclose history until their owner accepts the setting.
    recencyDigestBaseline: jsonb(
      'recency_digest_baseline',
    ).$type<RecencyDigestBaseline>(),
    recencyDigestTold: jsonb('recency_digest_told').$type<
      Array<RecencyDigestToldEntry>
    >(),
    // Set only when compaction actually re-resolves the baseline. This is the
    // durable event record for the one-shot supersession marker; compaction
    // rows themselves exist even when re-resolution is correctly skipped.
    //
    // Deliberately carries NO foreign key to `compactions.id`, unlike every
    // other id-bearing column in this file. `compactions.chat_id` already
    // references `chats.id` ON DELETE CASCADE, so a reference back would make
    // the two tables mutually dependent and put a cycle on the shipped
    // chat-deletion path. The constraint would buy nothing: a dangling id
    // fails safe, because the only read compares it for equality with the
    // active compaction's id and a stale value simply never matches, which
    // withholds the marker rather than asserting a re-bake that did not happen.
    recencyDigestRebakedFrom: uuid('recency_digest_rebaked_from'),
  },
  (t) => [
    // Matches findByOwner's ORDER BY (recency); pin state now lives in the
    // per-user `pins` table (rework-item-pinning), so the chat list no longer
    // orders pinned-first and needs no pin column/index here.
    index('chats_owner_updated_idx').on(t.ownerUserId, t.updatedAt),
    uniqueIndex('chats_id_owner_user_id_unique_idx').on(t.id, t.ownerUserId),
    index('chats_project_idx').on(t.projectId),
    // RLS policy: text = text comparison (no ::uuid cast — owner_user_id is text).
    // NOTE: `.enableRLS()` only emits ENABLE. The migration ALSO issues
    // `FORCE ROW LEVEL SECURITY` on both tables, which Drizzle cannot express here
    // (no force option in this version). FORCE is load-bearing for the single-role
    // self-hosted case — see migration 0004 and the relforcerowsecurity assertion in
    // chats-rls.integration.test.ts. If you regenerate this migration, re-add FORCE.
    pgPolicy('chats_owner', {
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
      // Filing gate: a chat may only be filed into a project the caller owns.
      // project_id IS NULL preserves the normal (unfiled) insert/update path.
      // The projects subquery runs under projects_owner RLS, so it yields exactly
      // the caller's own project ids — no recursion (projects never scans chats).
      withCheck: sql`owner_user_id = current_setting('app.current_user_id', true) AND (project_id IS NULL OR project_id IN (SELECT id FROM projects WHERE owner_user_id = current_setting('app.current_user_id', true)))`,
    }),
    // Public sharing (SELECT-only): a chat marked public is readable ONLY via
    // the no-identity `runAsPublic` path (current_user=''). Gating on the empty
    // identity keeps this policy from OR-ing public chats into a NORMAL
    // `runAs(userId)` read — so RLS alone still scopes an owner query to its own
    // chats (the "RLS is primary" invariant is preserved, not weakened to
    // "RLS + app filter"). A private chat matches NEITHER policy. No write.
    pgPolicy('chats_public_read', {
      for: 'select',
      using: sql`visibility = 'public' AND current_setting('app.current_user_id', true) = ''`,
    }),
  ],
).enableRLS();

export type Chat = InferSelectModel<typeof chats>;

export const messageRole = pgEnum('message_role', [
  'user',
  'assistant',
  'system',
  'tool',
]);

// A durable conversation turn (AI SDK v6 UIMessage shape) with sender attribution.
//
// senderUserId is nullable: set for human turns; null for assistant/system/tool.
// Resolves to a CANONICAL user (SPEC §7.1, §19.2).
// text — FK to users.id which is text (NextAuth convention).
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    // Immutable one-based insertion order within this Chat. `created_at`
    // defaults to now() = the TRANSACTION
    // timestamp, so messages written in one transaction (e.g. a user turn + its
    // assistant reply) share an identical created_at and cannot be ordered by it
    // deterministically. Allocation is explicit and Chat-local; queries and
    // the ContextBuilder order by it, not by created_at.
    seq: bigint('seq', { mode: 'number' }).notNull(),
    role: messageRole('role').notNull(),
    // nullable: set for human turns; null for assistant/system/tool.
    // onDelete: set null — deleting a user anonymizes their past messages rather
    // than blocking the delete or cascading away conversation history.
    senderUserId: text('sender_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    parts: jsonb('parts').$type<Array<unknown>>().notNull(), // AI SDK v6 UIMessage parts array
    attachments: jsonb('attachments')
      .$type<Array<unknown>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    usage: jsonb('usage'),
    inReplyTo: uuid('in_reply_to').references((): AnyPgColumn => messages.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('messages_chat_created_idx').on(t.chatId, t.createdAt),
    check('messages_seq_positive', sql`${t.seq} > 0`),
    // Ordering index: history is read with ORDER BY (chat_id, seq).
    uniqueIndex('messages_chat_seq_unique_idx').on(t.chatId, t.seq),
    uniqueIndex('messages_in_reply_to_unique_idx').on(t.inReplyTo),
    uniqueIndex('messages_id_chat_id_unique_idx').on(t.id, t.chatId),
    // RLS: access messages only when their chat is owned by the current user
    pgPolicy('messages_owner', {
      using: sql`chat_id IN (
        SELECT id FROM chats
        WHERE owner_user_id = current_setting('app.current_user_id', true)
      )`,
    }),
    // Public sharing (SELECT-only): messages of a public chat, readable ONLY via
    // runAsPublic (current_user=''). Same identity gate as chats_public_read, so
    // it never OR-s into an owner read. A private chat's messages match neither
    // this nor messages_owner under runAsPublic. No write.
    pgPolicy('messages_public_read', {
      for: 'select',
      using: sql`current_setting('app.current_user_id', true) = '' AND chat_id IN (SELECT id FROM chats WHERE visibility = 'public')`,
    }),
  ],
).enableRLS();

export type Message = InferSelectModel<typeof messages>;

export interface CompactionReplacementMessage {
  role: 'user' | 'assistant';
  parts: Array<unknown>;
}

// A context-compaction summary (#57) — a first-class row, not an opaque inline event,
// so long chats stay auditable and rewindable (Hermes-style lineage, SPEC §2.1).
//
// A compaction supersedes every message with seq <= uptoSeq; the context builder then
// assembles summary + messages after uptoSeq. `parentId` chains compactions: when a
// compacted chat compacts again, the new row points at the one it absorbed, so the
// full history remains reconstructable (messages are never deleted or mutated).
export const compactions = pgTable(
  'compactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    // Supersedes all messages with messages.seq <= upto_seq in this chat.
    uptoSeq: bigint('upto_seq', { mode: 'number' }).notNull(),
    // Lineage: the previous compaction this one absorbed (null for the first).
    parentId: uuid('parent_id').references((): AnyPgColumn => compactions.id, {
      onDelete: 'set null',
    }),
    // Model-facing summary text (objective, constraints, decisions, pending items).
    summary: text('summary').notNull(),
    // Complete application replay replacement for the superseded prefix.
    // Internal-only and runtime-validated before replay.
    replacementHistory: jsonb('replacement_history')
      .$type<Array<CompactionReplacementMessage>>()
      .notNull(),
    // Telemetry of the summarization call (TurnTelemetry shape), like messages.usage.
    usage: jsonb('usage'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Read path: latest compaction per chat (ORDER BY upto_seq DESC LIMIT 1).
    uniqueIndex('compactions_chat_upto_seq_idx').on(t.chatId, t.uptoSeq),
    uniqueIndex('compactions_id_chat_id_unique_idx').on(t.id, t.chatId),
    foreignKey({
      name: 'compactions_parent_id_chat_id_fk',
      columns: [t.parentId, t.chatId],
      foreignColumns: [t.id, t.chatId],
    }),
    // RLS: same shape as messages_owner. The migration ALSO issues
    // FORCE ROW LEVEL SECURITY (Drizzle can't express it) — see migration 0009
    // and the relforcerowsecurity assertion in chats-rls.integration.test.ts.
    pgPolicy('compactions_owner', {
      using: sql`chat_id IN (
        SELECT id FROM chats
        WHERE owner_user_id = current_setting('app.current_user_id', true)
      )`,
    }),
  ],
).enableRLS();

export type Compaction = InferSelectModel<typeof compactions>;

// The DB enum retains reserved future states for migration compatibility.
// Current runtime code emits only the subset named in SPEC §9.3. DB-enforced,
// like chat_visibility.
export const runStatus = pgEnum('run_status', [
  'queued',
  'resolving_config',
  'retrieving_context',
  'planning',
  'waiting_for_approval',
  'running_model',
  'running_tool',
  'running_sandbox',
  'updating_artifact',
  'summarizing',
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

// A durable run (#48, SPEC §9.3): every user message becomes a worker-processed
// run. One message may have several runs across retries; the run row is the
// unit of execution state, the run_events log is the source of truth.
/** One context item a run injected, as the model received it. */
export type RunContextItem = {
  readonly producer: string;
  readonly form?: string;
  readonly residency: 'prefix' | 'rail';
  readonly text: string;
};

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    // The triggering user message. set null (not cascade): deleting a message
    // must not erase the execution record.
    messageId: uuid('message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    // Tenant boundary (like chats.ownerUserId); text — FK to users.id.
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Opaque llame model id captured at enqueue time. Required: changing the
    // system default later must not silently alter an already queued run.
    modelId: text('model_id').notNull(),
    // Nullable only for pre-migration history. RunsRepository.create requires
    // this for every new run; the owner-constrained FK below prevents binding
    // another tenant's snapshot.
    modelContextSnapshotId: uuid('model_context_snapshot_id'),
    status: runStatus('status').notNull().default('queued'),
    // Which worker claimed the run (#48). Dead column today (no caller
    // populates it via markStarted) — out of scope for the liveness collapse
    // (durable-run-workers D7), left for a separate cleanup.
    workerId: text('worker_id'),
    // Cancellation request marker (#48): set by the API, honored by the worker —
    // at pickup (skip execution) or mid-flight (abort the model call). The DB is
    // the cross-process source of truth; the in-memory abort registry is the
    // fast path while worker and API share a process.
    cancelRequestedAt: timestamptz('cancel_requested_at'),
    // Terminal failure detail ({ message, ... }); null unless status is failed.
    error: jsonb('error'),
    // What this run actually injected on the context rail, AS RENDERED.
    //
    // Not derivable after the fact: an item's rendered wording is not
    // reproducible from its durable part once a renderer changes, and a
    // bind-time item is not reproducible at all. This column is therefore the
    // authority for what a past run injected.
    //
    // Deliberately NOT in `model_context_snapshots`: that table is
    // content-addressed and reused across runs whose prompt, declarations,
    // source, and availability manifest are identical, while injected items
    // vary per turn under exactly those conditions. Owner-only by
    // construction — `runs` carries `runs_owner` and no public-read policy.
    //
    // An item whose content originates outside this chat is not erasable
    // through that content's own source: deleting the source, or withdrawing
    // consent for it, does not reach a record already written.
    contextItems: jsonb('context_items').$type<Array<RunContextItem>>(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),
    // Reasoning effort resolved at accept time, stored concretely rather than
    // as a marker meaning "use the model's default" — same rule `model_id`
    // states: a later configuration edit must not alter an already queued run.
    //
    // The value is an opaque PROVIDER token, so this column deliberately
    // carries no enum or check constraint; the accepting API validated it
    // against the selected model's declared levels, and the worker sends it
    // verbatim without re-resolving or re-validating.
    //
    // Nullable for pre-migration history and for a model that declares no
    // effort vocabulary — NULL means "send no effort parameter", leaving the
    // provider's own default in force. Not backfilled with a literal (unlike
    // `model_id`, which execution cannot proceed without): a run that predates
    // the feature genuinely had no effort.
    effort: text('effort'),
  },
  (t) => [
    index('runs_chat_created_idx').on(t.chatId, t.createdAt),
    index('runs_user_status_idx').on(t.userId, t.status),
    index('runs_model_context_snapshot_idx').on(t.modelContextSnapshotId),
    foreignKey({
      name: 'runs_chat_id_user_id_fk',
      columns: [t.chatId, t.userId],
      foreignColumns: [chats.id, chats.ownerUserId],
    }),
    foreignKey({
      name: 'runs_message_id_chat_id_fk',
      columns: [t.messageId, t.chatId],
      foreignColumns: [messages.id, messages.chatId],
    }),
    foreignKey({
      name: 'runs_model_context_snapshot_id_user_id_fk',
      columns: [t.modelContextSnapshotId, t.userId],
      foreignColumns: [
        modelContextSnapshots.id,
        modelContextSnapshots.ownerUserId,
      ],
    }),
    // Per-chat single-flight (#48): at most one non-terminal run per chat —
    // the DB-level guarantee against concurrent double model calls (#73).
    // Safe now that heartbeat + the deadman (and retry-supersede in the loop)
    // guarantee every run eventually reaches a terminal status.
    uniqueIndex('runs_chat_inflight_unique')
      .on(t.chatId)
      .where(
        sql`status NOT IN ('completed', 'failed', 'cancelled', 'expired')`,
      ),
    pgPolicy('runs_owner', {
      using: sql`chat_id IN (
        SELECT id FROM chats
        WHERE owner_user_id = current_setting('app.current_user_id', true)
      )`,
    }),
  ],
).enableRLS();

export type Run = InferSelectModel<typeof runs>;
export type RunStatus = (typeof runStatus.enumValues)[number];

// Append-only run event log (#48, SPEC §9.4) — the durable, replayable source
// of truth for run progress. `sequence` is a table-global identity: monotonic
// within every run (what cursor replay needs), not dense per run. Rows are
// never updated or deleted; partitioning by created_at is deferred until the
// log actually grows (SPEC §9.4 keeps the shape partition-friendly).
export const runEvents = pgTable(
  'run_events',
  {
    sequence: bigint('sequence', { mode: 'number' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Replay path: WHERE run_id AND sequence > cursor ORDER BY sequence.
    index('run_events_run_sequence_idx').on(t.runId, t.sequence),
    pgPolicy('run_events_owner_select', {
      for: 'select',
      using: sql`run_id IN (
        SELECT runs.id FROM runs
        INNER JOIN chats ON chats.id = runs.chat_id
        WHERE chats.owner_user_id = current_setting('app.current_user_id', true)
      )`,
    }),
    pgPolicy('run_events_owner_insert', {
      for: 'insert',
      withCheck: sql`run_id IN (
        SELECT runs.id FROM runs
        INNER JOIN chats ON chats.id = runs.chat_id
        WHERE chats.owner_user_id = current_setting('app.current_user_id', true)
      )`,
    }),
  ],
).enableRLS();

export type RunEvent = InferSelectModel<typeof runEvents>;

// Re-export enum type for use in repository / service layer
export type MessageRole = (typeof messageRole.enumValues)[number];
