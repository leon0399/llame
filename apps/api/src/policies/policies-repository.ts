/**
 * PoliciesRepository (#45) — policy rows + the append-only decision log.
 * RLS (FORCE) scopes both; see the policies/policy_decisions table policies.
 */

import { asc, eq, inArray } from 'drizzle-orm';
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
    const current = await this.db
      .select()
      .from(policies)
      .where(eq(policies.id, id))
      .limit(1);
    if (!current[0]) {
      return undefined;
    }
    const [updated] = await this.db
      .update(policies)
      .set({
        ...patch,
        version: current[0].version + 1,
        updatedAt: new Date(),
      })
      .where(eq(policies.id, id))
      .returning();
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(policies).where(eq(policies.id, id));
  }

  /** All policy rows attached to the given scope keys (one round trip). */
  async findByScopes(keys: PolicyScopeKey[]): Promise<Policy[]> {
    if (keys.length === 0) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(policies)
      .where(
        inArray(
          policies.scopeId,
          keys.map((k) => k.scopeId),
        ),
      )
      .orderBy(asc(policies.createdAt));
    const wanted = new Set(keys.map((k) => `${k.scopeType}:${k.scopeId}`));
    return rows.filter((r) => wanted.has(`${r.scopeType}:${r.scopeId}`));
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
