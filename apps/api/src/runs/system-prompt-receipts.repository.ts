import { and, asc, eq } from 'drizzle-orm';

import {
  systemPromptReceipts,
  type SystemPromptReceipt,
} from '../db/schema/system-prompt-receipts';
import { type Db } from '../db/tenant-db.service';

/**
 * Immutable, owner-scoped access to system-prompt-only attempt receipts.
 *
 * Each execution attempt that reaches prompt preparation records its
 * rendered system text, prompt hash, and source. No tool declarations,
 * schemas, descriptions, or availability manifests are stored.
 */
export class SystemPromptReceiptsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Insert a system-prompt receipt for one execution attempt.
   * Unique on (ownerUserId, runId, attemptId) — duplicates are refused,
   * not content-addressed.
   */
  async create(input: {
    ownerUserId: string;
    runId: string;
    attemptId: string;
    source: SystemPromptReceipt['source'];
    systemPrompt: string;
    promptHash: string;
  }): Promise<SystemPromptReceipt> {
    const [created] = await this.db
      .insert(systemPromptReceipts)
      .values(input)
      .returning();
    return created;
  }

  /**
   * All receipts for one owner's run, ordered by creation time (earliest
   * attempt first). Returns an empty array before any attempt prepares,
   * or when the run is not owned.
   */
  async findByOwnedRun(
    runId: string,
    ownerUserId: string,
  ): Promise<Array<SystemPromptReceipt>> {
    return this.db
      .select()
      .from(systemPromptReceipts)
      .where(
        and(
          eq(systemPromptReceipts.runId, runId),
          eq(systemPromptReceipts.ownerUserId, ownerUserId),
        ),
      )
      .orderBy(asc(systemPromptReceipts.createdAt));
  }

  /**
   * Find the receipt for a specific attempt of a run, owner-scoped.
   */
  async findByAttempt(
    runId: string,
    attemptId: string,
    ownerUserId: string,
  ): Promise<SystemPromptReceipt | undefined> {
    const rows = await this.db
      .select()
      .from(systemPromptReceipts)
      .where(
        and(
          eq(systemPromptReceipts.runId, runId),
          eq(systemPromptReceipts.attemptId, attemptId),
          eq(systemPromptReceipts.ownerUserId, ownerUserId),
        ),
      )
      .limit(1);
    return rows[0];
  }
}
