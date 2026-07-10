import { Injectable } from '@nestjs/common';

import { type Db, TenantDbService } from '../db/tenant-db.service';
import { OrgUnitsRepository } from '../identity/identity-repository';
import { pathIds } from '../identity/org-path';
import { evaluatePolicies, type PolicyDecision } from './policy-eval';
import { PoliciesRepository, type PolicyScopeKey } from './policies-repository';

export type PolicyCheckInput = {
  /** The actor — always the verified session user, never client input. */
  userId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  /** Optional scope context: an org unit (its whole ancestor path applies). */
  orgUnitId?: string;
  /** Optional chat scope. */
  chatId?: string;
  /** Flat attribute context for jsonb condition matching. */
  context?: Record<string, unknown>;
};

/**
 * PolicyService (#45, SPEC §7.4–§7.5) — the "policy before capability" spine.
 * `check()` collects applicable policies across the scope chain (org path →
 * user → chat), evaluates deny-overrides-allow with default deny, logs the
 * decision (same transaction — an unauditable decision does not happen), and
 * returns effect + approval + matched policy versions.
 *
 * Consumers: the config resolver's deny-stripping step (#46) and every
 * tool/connector/model gate as those capabilities land (v0.4+). Nothing
 * mutates here on behalf of the caller — check is read + audit-append only.
 */
@Injectable()
export class PolicyService {
  constructor(private readonly tenantDb: TenantDbService) {}

  async check(input: PolicyCheckInput): Promise<PolicyDecision> {
    return this.tenantDb.runAs(input.userId, (tx) =>
      this.checkWithin(tx, input),
    );
  }

  /** Same check inside an existing tenant transaction. */
  async checkWithin(tx: Db, input: PolicyCheckInput): Promise<PolicyDecision> {
    // Scope chain: the org unit's whole ancestor path, then user, then chat
    // — mirroring the config resolver's inheritance order (#46). Depth does
    // not affect the verdict (deny overrides allow and approvals take the
    // strictest match, wherever they sit).
    const keys: PolicyScopeKey[] = [];
    if (input.orgUnitId) {
      const unit = await new OrgUnitsRepository(tx).findById(input.orgUnitId);
      if (!unit) {
        // Fail closed: an orgUnitId was supplied but could not be resolved —
        // either it doesn't exist, or RLS hid it because the caller isn't a
        // member of it or any of its ancestors. Either way, we cannot verify
        // the org-scope policies that should govern this request, so silently
        // falling back to a user/chat-only evaluation would let an unrelated
        // user-scope allow through an org-level deny never got the chance to
        // veto. Deny outright and log why (same audited path as every other
        // decision).
        const decision: PolicyDecision = {
          effect: 'deny',
          approval: null,
          reason: `invalid scope: org unit ${input.orgUnitId} not found or not accessible`,
          matched: [],
        };
        await new PoliciesRepository(tx).logDecision({
          userId: input.userId,
          action: input.action,
          ...(input.resourceType !== undefined
            ? { resourceType: input.resourceType }
            : {}),
          ...(input.resourceId !== undefined
            ? { resourceId: input.resourceId }
            : {}),
          effect: decision.effect,
          approval: decision.approval,
          matched: decision.matched,
          ...(input.context !== undefined ? { context: input.context } : {}),
        });
        return decision;
      }
      for (const id of pathIds(unit.path)) {
        keys.push({ scopeType: 'org_unit', scopeId: id });
      }
    }
    keys.push({ scopeType: 'user', scopeId: input.userId });
    if (input.chatId) {
      keys.push({ scopeType: 'chat', scopeId: input.chatId });
    }

    const repo = new PoliciesRepository(tx);
    const applicable = await repo.findByScopes(keys);

    const decision = evaluatePolicies(applicable, {
      action: input.action,
      ...(input.resourceType !== undefined
        ? { resourceType: input.resourceType }
        : {}),
      ...(input.resourceId !== undefined
        ? { resourceId: input.resourceId }
        : {}),
      ...(input.context !== undefined ? { context: input.context } : {}),
    });

    // Audit in the same transaction: a decision that cannot be logged is not
    // rendered (deterministic + logged, per the acceptance criteria).
    await repo.logDecision({
      userId: input.userId,
      action: input.action,
      ...(input.resourceType !== undefined
        ? { resourceType: input.resourceType }
        : {}),
      ...(input.resourceId !== undefined
        ? { resourceId: input.resourceId }
        : {}),
      effect: decision.effect,
      approval: decision.approval,
      matched: decision.matched,
      ...(input.context !== undefined ? { context: input.context } : {}),
    });

    return decision;
  }
}
