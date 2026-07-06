import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Summed estimate (from the built-in price table) over turns with a known cost. */
  costUsd: number;
  turnsWithKnownCost: number;
  turnsWithUnknownCost: number;
};

export type UsageByModel = {
  model: string;
  provider: string;
  totalTokens: number;
  costUsd: number;
};

export type UsageByDay = {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  totalTokens: number;
  costUsd: number;
};

export type UsageSummary = {
  days: number;
  total: UsageTotals;
  byModel: UsageByModel[];
  byDay: UsageByDay[];
};

/**
 * Aggregates the persisted per-turn `messages.usage` (TurnTelemetry) into a
 * BYOK spend view. Owner-scoped: the `chats.owner_user_id = :userId` JOIN is a
 * seatbelt on top of RLS (and the sharing `messages_public_read` policy, gated
 * on `current_user=''`, never applies under `runAs(userId)`), so it can only sum
 * the caller's own turns. Everything is windowed to the last `days` for a
 * consistent view. Extraction uses `::numeric` (robust to an absent field →
 * null → COALESCE/excluded), never `::int` (which would ERROR on a float value).
 * costUsd is an ESTIMATE (BYOK: no provider invoice).
 */
export class UsageRepository {
  constructor(private readonly db: Db) {}

  async summary(userId: string, days: number): Promise<UsageSummary> {
    // Unindexed jsonb scan on the shared connection — cap it (like search).
    await this.db.execute(sql`SET LOCAL statement_timeout = 5000`);

    // Reusable owner-scoped, windowed, assistant-turns-only predicate.
    const scope = sql`
      FROM messages m
      JOIN chats c ON c.id = m.chat_id
      WHERE c.owner_user_id = ${userId}
        AND m.usage IS NOT NULL
        AND m.created_at >= now() - make_interval(days => ${days})
    `;

    // The three aggregates are independent reads over the same owner-scoped
    // `scope` predicate — pipeline them on the transaction's single reserved
    // connection (postgres.js) instead of three sequential round trips. Order
    // is still guaranteed: the `SET LOCAL` above is awaited to completion
    // before any of these are issued, and a single Postgres backend processes
    // pipelined statements on one connection strictly in arrival order.
    const [totalsRows, byModelRows, byDayRows] = await Promise.all([
      this.db.execute<{
        input: string;
        output: string;
        total: string;
        cost: string;
        known: number;
        unknown: number;
      }>(sql`
        SELECT
          COALESCE(SUM((m.usage->>'inputTokens')::numeric), 0) AS input,
          COALESCE(SUM((m.usage->>'outputTokens')::numeric), 0) AS output,
          COALESCE(SUM((m.usage->>'totalTokens')::numeric), 0) AS total,
          COALESCE(SUM((m.usage->>'costUsd')::numeric)
            FILTER (WHERE m.usage->>'costUsd' IS NOT NULL), 0) AS cost,
          COUNT(*) FILTER (WHERE m.usage->>'costUsd' IS NOT NULL)::int AS known,
          COUNT(*) FILTER (WHERE m.usage->>'costUsd' IS NULL)::int AS unknown
        ${scope}
      `),
      this.db.execute<{
        model: string | null;
        provider: string | null;
        total: string;
        cost: string;
      }>(sql`
        SELECT
          m.usage->>'model' AS model,
          m.usage->>'provider' AS provider,
          COALESCE(SUM((m.usage->>'totalTokens')::numeric), 0) AS total,
          COALESCE(SUM((m.usage->>'costUsd')::numeric)
            FILTER (WHERE m.usage->>'costUsd' IS NOT NULL), 0) AS cost
        ${scope}
        GROUP BY m.usage->>'model', m.usage->>'provider'
        ORDER BY total DESC
      `),
      this.db.execute<{
        date: string;
        total: string;
        cost: string;
      }>(sql`
        SELECT
          to_char((m.created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date,
          COALESCE(SUM((m.usage->>'totalTokens')::numeric), 0) AS total,
          COALESCE(SUM((m.usage->>'costUsd')::numeric)
            FILTER (WHERE m.usage->>'costUsd' IS NOT NULL), 0) AS cost
        ${scope}
        GROUP BY date
        ORDER BY date ASC
      `),
    ]);
    const t = totalsRows[0];

    return {
      days,
      total: {
        inputTokens: Number(t?.input ?? 0),
        outputTokens: Number(t?.output ?? 0),
        totalTokens: Number(t?.total ?? 0),
        costUsd: Number(t?.cost ?? 0),
        turnsWithKnownCost: t?.known ?? 0,
        turnsWithUnknownCost: t?.unknown ?? 0,
      },
      byModel: [...byModelRows].map((r) => ({
        model: r.model ?? 'unknown',
        provider: r.provider ?? 'unknown',
        totalTokens: Number(r.total),
        costUsd: Number(r.cost),
      })),
      byDay: [...byDayRows].map((r) => ({
        date: r.date,
        totalTokens: Number(r.total),
        costUsd: Number(r.cost),
      })),
    };
  }
}
