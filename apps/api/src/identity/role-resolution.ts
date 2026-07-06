import { type Membership, type OrgRole } from '../db/schema';
import { pathIds } from './org-path';

/** An effective role and the membership that supplies it. */
export type EffectiveRole = {
  role: OrgRole;
  /** The org unit the deciding membership is attached to. */
  viaOrgUnitId: string;
  /** True when the role is inherited from an ancestor, not held on the unit itself. */
  inherited: boolean;
};

/**
 * Effective-role resolution (#44, SPEC §7.2/§7.3): given a unit's path and the
 * user's memberships along that path, the NEAREST membership wins — the most
 * specific node decides what to REPORT as the user's role in that scope
 * (org-wide admin, viewer in one team).
 *
 * This is reporting only, NOT an authorization gate: RLS's admin predicates
 * (`org_units_insert`/`update`/`delete`, `memberships_insert`/`update`) check
 * "owner/admin membership on ANY ancestor", independent of this nearest-wins
 * resolution — a role-based system without an explicit deny primitive cannot
 * have a lower-tier grant subtract permission an ancestor grant already
 * conferred (the same model GitHub organization/team and GitLab group/subgroup
 * roles use — team permissions are additive-only, with no per-team deny that
 * overrides an org owner). Deny/allow *policies* — including honoring an
 * intentional demotion for authorization, not just display — are #45's job:
 * roles here answer "what are you in this scope", not "may you do X". Pure:
 * callers fetch the candidate memberships (one indexed IN query over the
 * path's ids) and pass them in.
 */
export function resolveEffectiveRole(
  path: string,
  membershipsOnPath: Pick<Membership, 'orgUnitId' | 'role'>[],
): EffectiveRole | null {
  const ids = pathIds(path);
  const byUnit = new Map(membershipsOnPath.map((m) => [m.orgUnitId, m.role]));

  // Walk leaf → root: the first (deepest) membership decides.
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const role = byUnit.get(ids[i]);
    if (role !== undefined) {
      return {
        role,
        viaOrgUnitId: ids[i],
        inherited: i !== ids.length - 1,
      };
    }
  }
  return null;
}
