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
  integer,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';
import { sql } from 'drizzle-orm';
import { users } from './auth';
import { projects } from './projects';
import { type TurnToolAvailabilityEntry } from './model-context';
import { type PermissionMode } from '../../tools/permissions/permission-mode';

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

/** One admitted skill entry in the frozen prompt baseline. */
export type SkillCatalogBaselineEntry = {
  name: string;
  description: string;
};

/**
 * The frozen `skills` prompt projection (system-provided-skills D4): the
 * admitted entries in code-point name order plus how many proactively eligible
 * entries the bound left out. Names are derived from `entries` by the notices
 * layer's own told state, which is a separate column.
 */
export type SkillCatalogBaseline = {
  entries: Array<SkillCatalogBaselineEntry>;
  omitted: number;
};

/** The names a chat was last told about, in the order they were advertised. */
export type SkillCatalogTold = Array<string>;

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
    // durable event record for the one-shot supersession marker; checkpoint
    // rows exist even when re-resolution is correctly skipped.
    //
    // Deliberately carries NO foreign key to a checkpoint message. A checkpoint
    // row references its chat, so a reference back would make the two records
    // mutually dependent and put a cycle on the shipped chat-deletion path. The
    // constraint would buy nothing: a dangling id fails safe, because the only
    // read compares it for equality with the active checkpoint's id and a stale
    // value simply never matches, which withholds the marker rather than
    // asserting a re-bake that did not happen.
    recencyDigestRebakedFrom: uuid('recency_digest_rebaked_from'),
    // The frozen `skills` prompt projection (system-provided-skills D4).
    // NULL means this chat has never resolved a baseline; an instance with no
    // configured skill source never writes one, so a chat that never had skills
    // and one on an unconfigured instance are both NULL.
    skillCatalogBaseline: jsonb(
      'skill_catalog_baseline',
    ).$type<SkillCatalogBaseline>(),
    // The checkpoint message id the baseline was resolved under. Same deliberate
    // absence of a foreign key as `recencyDigestRebakedFrom`: a stale value
    // simply never matches the active checkpoint, so it re-resolves rather
    // than asserting a re-bake that did not happen.
    skillCatalogRebakedFrom: uuid('skill_catalog_rebaked_from'),
    // Names of the advertised entries this chat was last TOLD about (D6).
    // Names only: an addition renders the entry's CURRENT description, so a
    // description-only change cannot produce a notice, and the told state
    // cannot itself become a stale copy of catalog content.
    skillCatalogTold: jsonb('skill_catalog_told').$type<Array<string>>(),
    workspaceRoot: text('workspace_root'),
    workspaceExecutorId: text('workspace_executor_id'),
    workspaceGeneration: integer('workspace_generation').notNull().default(0),
    workspaceTold: text('workspace_told'),
    // The checkpoint epoch in which the Workspace snapshot was last told.
    // Deliberately carries no foreign key, matching skillCatalogRebakedFrom:
    // a stale id fails closed and causes the next turn to re-tell the snapshot.
    workspaceToldFrom: uuid('workspace_told_from'),
    workspaceDetachReason: text('workspace_detach_reason'),
  },
  (t) => [
    // Matches findByOwner's ORDER BY (recency); pin state now lives in the
    // per-user `pins` table (rework-item-pinning), so the chat list no longer
    // orders pinned-first and needs no pin column/index here.
    index('chats_owner_updated_idx').on(t.ownerUserId, t.updatedAt),
    uniqueIndex('chats_id_owner_user_id_unique_idx').on(t.id, t.ownerUserId),
    index('chats_project_idx').on(t.projectId),
    check(
      'chats_workspace_detach_reason_check',
      sql`${t.workspaceDetachReason} IS NULL OR ${t.workspaceDetachReason} IN ('executor_mismatch', 'executor_absent', 'root_missing', 'root_moved', 'permission_rejected', 'tool_not_allowed')`,
    ),
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
  'checkpoint',
]);

// A durable conversation turn (AI SDK v6 UIMessage shape) with sender attribution.
//
// senderUserId is nullable: set for human turns; null for assistant/system/tool/checkpoint.
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
    // The last Chat-local sequence absorbed by a checkpoint. NULL on every
    // other message role.
    absorbedThroughSeq: bigint('absorbed_through_seq', { mode: 'number' }),
    // nullable: set for human turns; null for assistant/system/tool/checkpoint.
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
    // A boundary names the checkpoint row that absorbed it and no other row
    // carries one, so replay never reads a boundary-less checkpoint as "no
    // checkpoint". Text comparison keeps the constraint valid in the same
    // transaction that adds the `checkpoint` enum value.
    check(
      'messages_checkpoint_boundary_check',
      sql`(${t.role}::text = 'checkpoint') = (${t.absorbedThroughSeq} IS NOT NULL)`,
    ),
    // Ordering index: history is read with ORDER BY (chat_id, seq).
    uniqueIndex('messages_chat_seq_unique_idx').on(t.chatId, t.seq),
    uniqueIndex('messages_chat_absorbed_through_seq_uidx')
      .on(t.chatId, t.absorbedThroughSeq)
      .where(sql`${t.absorbedThroughSeq} IS NOT NULL`),
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
    // this nor messages_owner under runAsPublic. Checkpoint text is owner-derived
    // summary content and must never cross the public boundary.
    pgPolicy('messages_public_read', {
      for: 'select',
      using: sql`current_setting('app.current_user_id', true) = '' AND chat_id IN (SELECT id FROM chats WHERE visibility = 'public') AND role::text <> 'checkpoint'`,
    }),
  ],
).enableRLS();

export type Message = InferSelectModel<typeof messages>;

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
    status: runStatus('status').notNull().default('queued'),
    // Trusted native executor identity, bound by the first native file call.
    // Retained across queue claims so physical paths cannot move to another host.
    workerId: text('worker_id'),
    // Cancellation request marker (#48): set by the API, honored by the worker —
    // at pickup (skip execution) or mid-flight (abort the model call). The DB is
    // the cross-process source of truth; the in-memory abort registry is the
    // fast path while worker and API share a process.
    cancelRequestedAt: timestamptz('cancel_requested_at'),
    // Terminal failure detail ({ message, ... }); null unless status is failed.
    error: jsonb('error'),
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
    permissionMode: text('permission_mode')
      .notNull()
      .default('default')
      .$type<PermissionMode>(),
    // Fresh UUID assigned atomically by each queue-authorized claim/reclaim.
    // Distinct from workerId (native executor trust) — this is the attempt
    // identity for fencing receipts, invocation admission, and publication.
    activeAttemptId: uuid('active_attempt_id'),
    // Recorded on successful finalization to identify the winning attempt.
    completedAttemptId: uuid('completed_attempt_id'),
    // Minimal availability record for this successfully committed turn:
    // sorted tool ids and their available/unavailable state. Written only
    // in successful-turn finalization. Empty `[]` means observed-all-absent;
    // null means no committed observation (pre-cutover or failed run).
    turnToolAvailability: jsonb('turn_tool_availability').$type<
      Array<TurnToolAvailabilityEntry>
    >(),
  },
  (t) => [
    index('runs_chat_created_idx').on(t.chatId, t.createdAt),
    index('runs_user_status_idx').on(t.userId, t.status),
    check(
      'runs_permission_mode_check',
      sql`${t.permissionMode} IN ('default', 'bypass')`,
    ),
    // Composite target for owner-matching system prompt receipts.
    uniqueIndex('runs_id_user_id_unique_idx').on(t.id, t.userId),
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
