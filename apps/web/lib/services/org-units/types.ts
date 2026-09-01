import type {
  EffectiveRoleResponse as GeneratedEffectiveRoleResponse,
  MembershipResponse as GeneratedMembershipResponse,
  MembershipResponseRole,
  OrgUnitResponse as GeneratedOrgUnitResponse,
  OrgUnitResponseType,
} from "../../api/generated/models";

/** Full role vocabulary, as returned in response payloads. */
export type OrgRole = MembershipResponseRole;

const ORG_ROLES = [
  "owner",
  "admin",
  "maintainer",
  "member",
  "viewer",
  "guest",
  "service_account",
] as const satisfies ReadonlyArray<OrgRole>;

/** Grantable/settable via HTTP: every role except `service_account`. */
export type GrantableRole = Exclude<OrgRole, "service_account">;

// Derived rather than restated: `ORG_ROLES` carries the `satisfies` check that
// the vocabulary covers `OrgRole` exactly, and writing the six grantable roles
// out again would be a second list to keep in sync with it. Mirrors the api's
// own `ORG_ROLES.filter(...)` in identity.dto.ts.
export const GRANTABLE_ROLES: Array<GrantableRole> =
  ORG_ROLES.filter(isGrantableRole);

/** Narrows an `OrgRole` from a response payload to a role that's settable via HTTP. */
export function isGrantableRole(role: OrgRole): role is GrantableRole {
  return role !== "service_account";
}

// Component-facing aliases keep generated models behind the feature service.
export type OrgUnitType = OrgUnitResponseType;
export type OrgUnitResponse = GeneratedOrgUnitResponse;
export type MembershipResponse = GeneratedMembershipResponse;
export type EffectiveRoleResponse = GeneratedEffectiveRoleResponse;
