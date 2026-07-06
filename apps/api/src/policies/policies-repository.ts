/**
 * PoliciesRepository (#45) — policy rows + the append-only decision log.
 * RLS (FORCE) scopes both; see the policies/policy_decisions table policies.
 */

import { and, asc, eq, or, sql } from 'drizzle-orm';
import {
  policies,
  policyDecisions,
  type ApprovalLevel,
  type Policy,
  type PolicyEffect,
  type PolicyScopeType,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';

export type PolicyScopeKey = { scopeType: PolicyScopeType; scopeId: string };

export class PoliciesRepository {
  constructor(private readonly db: Db) {}

  async create(input: {
    scopeType: PolicyScopeType;
    scopeId: string;
    effect: PolicyEffect;
    action: string;
    resourceType?: string;
    resourceId?: string;
    conditions?: Record<string, unknown>;
    approval?: ApprovalLevel;
  }): Promise<Policy> {
    const [created] = await this.db.insert(policies).values(input).returning();
    return created;
  }

  /** Update a policy's rule fields, bumping `version` (#45 versioning). */
  async update(
    id: string,
    patch: Partial<
      Pick<
        Policy,
        | 'effect'
        | 'action'
        | 'resourceType'
        | 'resourceId'
        | 'conditions'
        | 'approval'
      >
    >,
  ): Promise<Policy | undefined> {
    // Atomic increment (SET version = version + 1) rather than read-then-
    // write: two concurrent updates racing on a select-then-write would both
    // compute the same "next" version from the same stale read, silently
    // under-counting how many writes actually happened — this table's whole
    // point is that `version` is a trustworthy write counter for the audit
    // trail (#45 versioning).
    const [updated] = await this.db
      .update(policies)
      .set({
        ...patch,
        version: sql`${policies.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(policies.id, id))
      .returning();
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(policies).where(eq(policies.id, id));
  }

  /**
   * All policy rows attached to the given scope keys (one round trip).
   * Filters on (scope_type, scope_id) together — matching `policies_scope_idx`
   * leading-column order — rather than scope_id alone plus an in-memory
   * post-filter, which couldn't use the composite index.
   */
  async findByScopes(keys: PolicyScopeKey[]): Promise<Policy[]> {
    if (keys.length === 0) {
      return [];
    }
    return this.db
      .select()
      .from(policies)
      .where(
        or(
          ...keys.map((k) =>
            and(
              eq(policies.scopeType, k.scopeType),
              eq(policies.scopeId, k.scopeId),
            ),
          ),
        ),
      )
      .orderBy(asc(policies.createdAt));
  }

  /** Append one decision to the audit log (no update/delete surface). */
  async logDecision(input: {
    userId: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    effect: PolicyEffect;
    approval: ApprovalLevel | null;
    matched: unknown;
    context?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(policyDecisions).values({
      userId: input.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      effect: input.effect,
      approval: input.approval,
      matched: input.matched,
      context: input.context,
    });
  }
}
