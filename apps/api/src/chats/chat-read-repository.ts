import { sql, type SQL } from 'drizzle-orm';
import {
  formatMachineLocator,
  parseMachineLocator,
} from '../machines/machine-locator';
import { type ChatRow, formatChatExcerpt } from './chat-row';
import { type Db } from '../db/tenant-db.service';
import { findConversationMessage } from './conversation-message-lookup';
import { eligibleMessagePredicate } from './message-eligibility';

export type ChatReadMessage = {
  chatId: string;
  seq: number;
  role: 'user' | 'assistant';
  parts: Array<unknown>;
  usage: unknown;
  createdAt: Date;
  previousMessageSeq?: number;
  nextMessageSeq?: number;
};

export type ChatReadRow = ChatRow & { runStatus: string };

export type ChatIndexRow = Pick<
  ChatReadMessage,
  'seq' | 'role' | 'createdAt' | 'parts'
>;

const eligible = eligibleMessagePredicate('m');

/** Trusted-owner queries require both the owner predicate and session-identity guard. */
export class ChatReadRepository {
  constructor(private readonly db: Db) {}

  readMessage(
    chatId: string,
    ownerUserId: string,
    seq: number,
  ): Promise<ChatReadMessage | undefined> {
    return findConversationMessage(this.db, chatId, ownerUserId, seq);
  }

  async listEligibleIndex(
    chatId: string,
    ownerUserId: string,
    window: { start?: number; end?: number; beforeSeq?: number; limit: number },
  ): Promise<Array<ChatIndexRow>> {
    const { start, end, beforeSeq, limit } = window;
    const ascending = beforeSeq === undefined && start !== undefined;

    const conditions: Array<SQL> = [
      sql`c.id = ${chatId}::uuid`,
      sql`c.owner_user_id = ${ownerUserId}`,
      sql`current_setting('app.current_user_id', true) = ${ownerUserId}`,
      eligible,
    ];

    if (start !== undefined) conditions.push(sql`m.seq >= ${start}`);

    if (end !== undefined) conditions.push(sql`m.seq <= ${end}`);

    if (beforeSeq !== undefined) conditions.push(sql`m.seq < ${beforeSeq}`);

    const rows = await this.db.execute<ChatIndexQueryRow>(sql`
      SELECT m.seq, m.role, m.parts, m.created_at AS "createdAt"
      FROM messages m JOIN chats c ON c.id = m.chat_id
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY ${ascending ? sql`m.seq ASC` : sql`m.seq DESC`}
      LIMIT ${limit}
    `);

    return mapEligibleIndexRows(rows, ascending);
  }

  async previousEligibleSequences(
    chatId: string,
    ownerUserId: string,
    beforeSeq: number,
    limit: number,
  ): Promise<Array<{ seq: number }>> {
    const rows = await this.db.execute<{ seq: number | string }>(sql`
      SELECT m.seq
      FROM messages m JOIN chats c ON c.id = m.chat_id
      WHERE c.id = ${chatId}::uuid AND c.owner_user_id = ${ownerUserId}
        AND current_setting('app.current_user_id', true) = ${ownerUserId}
        AND ${eligible}
        AND m.seq < ${beforeSeq}
      ORDER BY m.seq DESC
      LIMIT ${limit}
    `);

    return [...rows].map((row) => ({ seq: Number(row.seq) }));
  }

  readChatRows(
    ownerUserId: string,
    offset: number,
    limit: number,
  ): Promise<{ rows: Array<ChatReadRow>; total: number }> {
    return this.db
      .execute<ChatReadQueryRow>(sql`
      WITH owned AS (
        SELECT c.id, c.title, c.updated_at AS activity_at, c.workspace_root, c.workspace_executor_id,
          (SELECT p.position FROM pins p WHERE p.user_id = ${ownerUserId} AND p.item_type = 'chat' AND p.item_id = c.id) AS pin_position,
          (SELECT min(m.seq) FROM messages m WHERE m.chat_id = c.id AND m.role = 'user' AND ${eligibleMessagePredicate('m')}) AS first_seq,
          (SELECT max(m.seq) FROM messages m WHERE m.chat_id = c.id AND ${eligibleMessagePredicate('m')}) AS last_seq,
          (SELECT count(*)::int FROM messages m WHERE m.chat_id = c.id AND ${eligibleMessagePredicate('m')}) AS message_count,
          (SELECT count(*)::int FROM chats x WHERE x.owner_user_id = ${ownerUserId} AND x.archived_at IS NULL
            AND current_setting('app.current_user_id', true) = ${ownerUserId}) AS total
        FROM chats c WHERE c.owner_user_id = ${ownerUserId} AND c.archived_at IS NULL
          AND current_setting('app.current_user_id', true) = ${ownerUserId}
        ORDER BY pin_position ASC NULLS LAST, c.updated_at DESC, c.id LIMIT ${limit} OFFSET ${offset}
      ), enriched AS (
        SELECT o.*,
          ${ownedMessageText(sql`m.seq = o.first_seq AND m.role = 'user'`)} AS opening_text,
          ${ownedMessageText(sql`m.seq = o.last_seq AND o.last_seq IS DISTINCT FROM o.first_seq`)} AS latest_text,
          (SELECT r.status FROM runs r WHERE r.chat_id = o.id AND r.user_id = ${ownerUserId}
            AND current_setting('app.current_user_id', true) = ${ownerUserId}
            AND r.status IN ('queued', 'running_model', 'awaiting_jobs', 'awaiting_quota')
           ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS run_status
        FROM owned o
      )
      SELECT e.id AS "chatId", e.title, e.activity_at AS "activityAt", e.message_count AS "messageCount",
        e.workspace_root AS "workspaceRoot", e.workspace_executor_id AS "workspaceExecutorId",
        e.opening_text AS "openingText", e.latest_text AS "latestText", e.run_status AS "runStatus", e.total
      FROM enriched e
    `)
      .then(mapChatRows);
  }

  async countOwnedChats(ownerUserId: string): Promise<number> {
    const rows = await this.db.execute<{ total: number | string }>(sql`
      SELECT count(*)::int AS total FROM chats c
      WHERE c.owner_user_id = ${ownerUserId} AND c.archived_at IS NULL
        AND current_setting('app.current_user_id', true) = ${ownerUserId}
    `);

    return Number([...rows][0]?.total ?? 0);
  }

  async ownsChat(chatId: string, ownerUserId: string): Promise<boolean> {
    const rows = await this.db.execute<{ present: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM chats c WHERE c.id = ${chatId}::uuid AND c.owner_user_id = ${ownerUserId}
        AND current_setting('app.current_user_id', true) = ${ownerUserId}) AS present
    `);

    return [...rows][0]?.present === true;
  }

  async currentRunStatus(chatId: string, ownerUserId: string): Promise<string> {
    const rows = await this.db.execute<{ status: string | null }>(sql`
      SELECT r.status FROM runs r JOIN chats c ON c.id = r.chat_id
      WHERE c.id = ${chatId}::uuid AND c.owner_user_id = ${ownerUserId}
        AND current_setting('app.current_user_id', true) = ${ownerUserId}
        AND r.user_id = ${ownerUserId}
        AND r.status IN ('queued', 'running_model', 'awaiting_jobs', 'awaiting_quota')
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1
    `);

    return normalizeStatus([...rows][0]?.status);
  }

  async maxCommittedSequence(
    chatId: string,
    ownerUserId: string,
  ): Promise<number> {
    const rows = await this.db.execute<{ maxSeq: string | number | null }>(sql`
      SELECT max(m.seq) AS "maxSeq" FROM messages m JOIN chats c ON c.id = m.chat_id
      WHERE c.id = ${chatId}::uuid AND c.owner_user_id = ${ownerUserId}
        AND current_setting('app.current_user_id', true) = ${ownerUserId}
    `);

    return Number([...rows][0]?.maxSeq ?? 0);
  }
}

type ChatIndexQueryRow = {
  seq: number | string;
  role: ChatIndexRow['role'];
  parts: ChatIndexRow['parts'];
  createdAt: Date | string;
};

type ChatReadQueryRow = {
  chatId: string;
  title: string | null;
  activityAt: Date | string;
  messageCount: number | string;
  workspaceRoot: string | null;
  workspaceExecutorId: string | null;
  openingText: string | null;
  latestText: string | null;
  runStatus: string | null;
  total: string | number;
};

/** Joins the text parts of the eligible message in owned chat `o` that matches `message`. */
function ownedMessageText(message: SQL): SQL {
  return sql`(SELECT string_agg(p.part ->> 'text', E'\\n\\n' ORDER BY p.ordinality)
    FROM messages m CROSS JOIN LATERAL json_array_elements(m.parts) WITH ORDINALITY p(part, ordinality)
    WHERE m.chat_id = o.id AND ${message} AND ${eligible}
      AND p.part ->> 'type' = 'text' AND json_typeof(p.part -> 'text') = 'string')`;
}

function mapEligibleIndexRows(
  rows: ReadonlyArray<ChatIndexQueryRow>,
  ascending: boolean,
) {
  const mapped: Array<ChatIndexRow> = [];

  for (const row of rows) {
    mapped.push({
      seq: Number(row.seq),
      role: row.role,
      parts: row.parts,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    });
  }

  if (!ascending) mapped.reverse();

  return mapped;
}

function mapChatRows(rows: ReadonlyArray<ChatReadQueryRow>) {
  const mapped: Array<ChatReadRow> = [];

  for (const row of rows) {
    mapped.push({
      chatId: String(row.chatId),
      locator: `chat://${row.chatId}`,
      title: row.title,
      activityAt:
        row.activityAt instanceof Date
          ? row.activityAt.toISOString()
          : new Date(row.activityAt).toISOString(),
      messageCount: Number(row.messageCount),
      workspace: workspaceLocator(row.workspaceRoot, row.workspaceExecutorId),
      openingExcerpt: formatChatExcerpt(row.openingText, 100),
      latestExcerpt: formatChatExcerpt(row.latestText, 100),
      runStatus: normalizeStatus(row.runStatus),
    });
  }

  return { rows: mapped, total: Number(rows[0]?.total ?? 0) };
}

function workspaceLocator(
  root: string | null,
  executorId: string | null,
): string {
  if (root === null) return 'unbound';
  const parsed = parseMachineLocator(root);

  if (parsed.kind === 'path' && parsed.selector === undefined)
    return formatMachineLocator(parsed.name, parsed.path) ?? 'unbound';

  if (root.startsWith('/') && !root.startsWith('//') && executorId !== null)
    return formatMachineLocator(executorId, root) ?? 'unbound';

  return 'unbound';
}

function normalizeStatus(value: string | null | undefined): string {
  return value === 'queued' ||
    value === 'running_model' ||
    value === 'awaiting_jobs' ||
    value === 'awaiting_quota'
    ? value
    : 'idle';
}
