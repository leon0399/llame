import type {
  EffectiveRoleResponse as GeneratedEffectiveRoleResponse,
  MembershipResponse as GeneratedMembershipResponse,
  MembershipResponseRole,
  OrgUnitResponse as GeneratedOrgUnitResponse,
  OrgUnitResponseType,
} from "../../api/generated/models";

/** Full role vocabulary, as returned in response payloads. */
export type OrgRole = MembershipResponseRole;

export const ORG_ROLES = [
  "owner",
  "admin",
  "maintainer",
  "member",
  "viewer",
  "guest",
  "service_account",
] as const satisfies readonly OrgRole[];

/** Grantable/settable via HTTP: every role except `service_account`. */
export type GrantableRole = Exclude<OrgRole, "service_account">;
export const GRANTABLE_ROLES: GrantableRole[] = [
  "owner",
  "admin",
  "maintainer",
  "member",
  "viewer",
  "guest",
];

/** Narrows an `OrgRole` from a response payload to a role that's settable via HTTP. */
export function isGrantableRole(role: OrgRole): role is GrantableRole {
  return role !== "service_account";
}

// Component-facing aliases keep generated models behind the feature service.
export type OrgUnitType = OrgUnitResponseType;
export type OrgUnitResponse = GeneratedOrgUnitResponse;
export type MembershipResponse = GeneratedMembershipResponse;
export type EffectiveRoleResponse = GeneratedEffectiveRoleResponse;
