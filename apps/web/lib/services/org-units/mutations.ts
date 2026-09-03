import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import {
  changeOrgUnitMembershipRole as changeOrgUnitMembershipRoleEndpoint,
  createChildOrgUnit,
  createRootOrgUnit,
  deleteOrgUnit as deleteOrgUnitEndpoint,
  grantOrgUnitMembership,
  revokeOrgUnitMembership,
  updateOrgUnit as updateOrgUnitEndpoint,
} from "../../api/generated/org-units/org-units";
import type { CreateOrgUnitDto } from "../../api/generated/models";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import { withOrgUnitsErrors } from "./errors";
import { orgUnitsQueryKeys } from "./queries";
import type {
  GrantableRole,
  MembershipResponse,
  OrgUnitResponse,
  OrgUnitType,
} from "./types";

/**
 * REFERENCE PATTERN for this repo's TanStack Query mutations — mirror this
 * shape for future features, not the org-units specifics:
 *
 * - Fetchers (`createRootOrg`, `updateOrgUnit`, …) are plain transport
 *   functions with zero cache knowledge; a hook's `mutationFn` points
 *   straight at one.
 * - Every hook sets a `mutationKey` (`orgUnitsMutationKeys` below),
 *   mirroring the query-key factory convention (`orgUnitsQueryKeys`) — this
 *   makes mutations legible in devtools and addressable via
 *   `useMutationState` for cross-component pending indicators.
 * - Optimistic cache patches are applied ONLY when the client can compute
 *   the exact next state (a rename, a role change, a row removal).
 *   Creations and grants are invalidate-on-success only — the server
 *   assigns fields (id, path, createdAt, …) the client can't predict, so an
 *   invented row would be visibly wrong until the refetch replaced it.
 * - Every optimistic hook follows the same discipline: cancel in-flight
 *   queries for the affected key → snapshot the previous value → patch the
 *   cache → (onError) roll back to the snapshot → (onSettled, always)
 *   invalidate to resync with server truth.
 */
export const orgUnitsMutationKeys = {
  all: ["org-units", "mutations"] as const,
  createRoot: () => [...orgUnitsMutationKeys.all, "create-root"] as const,
  createChild: () => [...orgUnitsMutationKeys.all, "create-child"] as const,
  update: () => [...orgUnitsMutationKeys.all, "update"] as const,
  delete: () => [...orgUnitsMutationKeys.all, "delete"] as const,
  grant: () => [...orgUnitsMutationKeys.all, "grant"] as const,
  changeRole: () => [...orgUnitsMutationKeys.all, "change-role"] as const,
  revoke: () => [...orgUnitsMutationKeys.all, "revoke"] as const,
};

function authenticatedFetch(): typeof fetch {
  return createAuthenticatedBrowserFetch(globalThis.fetch);
}

export async function createRootOrg(input: {
  name: string;
}): Promise<OrgUnitResponse> {
  return withOrgUnitsErrors(() =>
    // No explicit type: the API's createRoot defaults a root to
    // 'organization' — the invariant lives server-side, for every client.
    createRootOrgUnit(input, undefined, authenticatedFetch()),
  );
}

export function useCreateRootOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: orgUnitsMutationKeys.createRoot(),
    scope: { id: "org-units-tree" },
    mutationFn: createRootOrg,
    // No optimistic insert: the server generates id/path/memberCount — an
    // invented row would be wrong in visible ways until the refetch below
    // replaced it. Invalidate-on-success only.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orgUnitsQueryKeys.lists() }),
  });
}

export async function createChildOrg(input: {
  parentId: string;
  name: string;
  /** Child dialog's type segment (task 4.3) — group/team/department only. */
  type?: OrgUnitType;
}): Promise<OrgUnitResponse> {
  const body: CreateOrgUnitDto = { name: input.name };
  if (input.type) {
    body.type = input.type;
  }
  return withOrgUnitsErrors(() =>
    createChildOrgUnit(input.parentId, body, undefined, authenticatedFetch()),
  );
}

export function useCreateChildOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: orgUnitsMutationKeys.createChild(),
    scope: { id: "org-units-tree" },
    mutationFn: createChildOrg,
    // No optimistic insert — same reasoning as useCreateRootOrg: the
    // server assigns id/path/type-default, so invalidate-on-success only.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orgUnitsQueryKeys.lists() }),
  });
}

export type UpdateOrgUnitInput = {
  orgUnitId: string;
  name?: string;
  parentId?: string | null;
};

export async function updateOrgUnit(
  input: UpdateOrgUnitInput,
): Promise<OrgUnitResponse> {
  const { orgUnitId, ...body } = input;
  return withOrgUnitsErrors(() =>
    updateOrgUnitEndpoint(orgUnitId, body, undefined, authenticatedFetch()),
  );
}

/**
 * Rename and/or move (D5 PATCH semantics). On a concurrent-reorganization
 * 409, the org-admin-ui spec requires an automatic refetch of the tree
 * (not just an error message) so the user retries against current state —
 * see the onSettled comment below for how that's satisfied.
 */
// Deliberately does NOT recompute `path`: sibling ordering after a move is
// server-computed (materialized id-path), not something the client can
// derive — the onSettled refetch in useUpdateOrgUnit corrects it.
function applyOrgUnitPatch(
  unit: OrgUnitResponse,
  variables: UpdateOrgUnitInput,
): OrgUnitResponse {
  if (unit.id !== variables.orgUnitId) return unit;
  const patched = { ...unit };
  if (variables.name !== undefined) {
    patched.name = variables.name;
  }
  if (variables.parentId !== undefined) {
    patched.parentId = variables.parentId;
  }
  return patched;
}

export function useUpdateOrgUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: orgUnitsMutationKeys.update(),
    scope: { id: "org-units-tree" },
    mutationFn: updateOrgUnit,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: orgUnitsQueryKeys.lists() });
      const previousLists = queryClient.getQueryData<Array<OrgUnitResponse>>(
        orgUnitsQueryKeys.lists(),
      );
      // Untouched when the list was never fetched (e.g. mutating before the
      // query mounted) — nothing to patch, and nothing to roll back later.
      if (previousLists) {
        queryClient.setQueryData<Array<OrgUnitResponse>>(
          orgUnitsQueryKeys.lists(),
          previousLists.map((unit) => applyOrgUnitPatch(unit, variables)),
        );
      }
      return { previousLists };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousLists) {
        queryClient.setQueryData(
          orgUnitsQueryKeys.lists(),
          context.previousLists,
        );
      }
    },
    onSettled: () => {
      // Always resync with the server, success or failure. This subsumes
      // the concurrent-reorg auto-refetch requirement above (org-admin-ui
      // spec's "automatic query refetch" on a 409 CONCURRENT_TREE_CHANGE) —
      // a dedicated onError special case is redundant once onSettled always
      // invalidates.
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.lists(),
      });
    },
  });
}

export async function deleteOrgUnit(orgUnitId: string): Promise<void> {
  await withOrgUnitsErrors(() =>
    deleteOrgUnitEndpoint(orgUnitId, undefined, authenticatedFetch()),
  );
}

export function useDeleteOrgUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: orgUnitsMutationKeys.delete(),
    scope: { id: "org-units-tree" },
    mutationFn: deleteOrgUnit,
    onMutate: async (orgUnitId) => {
      await queryClient.cancelQueries({ queryKey: orgUnitsQueryKeys.lists() });
      const previousLists = queryClient.getQueryData<Array<OrgUnitResponse>>(
        orgUnitsQueryKeys.lists(),
      );
      if (previousLists) {
        // Removing just this row is sufficient (no orphan patching needed):
        // the API enforces leaf-first delete (D4/task 4.1 — a unit with
        // children 409s HAS_CHILDREN), so a unit that reaches this mutation
        // is guaranteed to have no descendants left dangling in the cache.
        queryClient.setQueryData<Array<OrgUnitResponse>>(
          orgUnitsQueryKeys.lists(),
          previousLists.filter((unit) => unit.id !== orgUnitId),
        );
      }
      return { previousLists };
    },
    onError: (_error, _orgUnitId, context) => {
      if (context?.previousLists) {
        queryClient.setQueryData(
          orgUnitsQueryKeys.lists(),
          context.previousLists,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.lists(),
      });
    },
  });
}

export type GrantMembershipInput = {
  orgUnitId: string;
  userId: string;
  role: GrantableRole;
};

export async function grantMembership(
  input: GrantMembershipInput,
): Promise<void> {
  await withOrgUnitsErrors(() =>
    grantOrgUnitMembership(
      input.orgUnitId,
      { userId: input.userId, role: input.role },
      undefined,
      authenticatedFetch(),
    ),
  );
}

export function useGrantMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: orgUnitsMutationKeys.grant(),
    scope: { id: "org-unit-memberships" },
    mutationFn: grantMembership,
    // No optimistic insert: the server generates the membership row's id
    // and createdAt — invalidate-on-success only, same rule as the org
    // creations above.
    onSuccess: (_data, { orgUnitId }) => {
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.memberships(orgUnitId),
      });
      // The grantee may be the CALLER (creator-visibility edge: they see the
      // unit as its creator but hold no membership yet) — refresh "my role
      // here" so role-gated UI reflects the new effective role immediately.
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.myRole(orgUnitId),
      });
    },
  });
}

export type ChangeMembershipRoleInput = {
  orgUnitId: string;
  userId: string;
  role: GrantableRole;
};

export async function changeMembershipRole(
  input: ChangeMembershipRoleInput,
): Promise<MembershipResponse> {
  return withOrgUnitsErrors(() =>
    changeOrgUnitMembershipRoleEndpoint(
      input.orgUnitId,
      input.userId,
      { role: input.role },
      undefined,
      authenticatedFetch(),
    ),
  );
}

/** Shared onMutate prefix for both membership hooks below: cancel in-flight
 * membership reads for this unit and return whatever was cached. */
async function cancelAndSnapshotMemberships(
  queryClient: QueryClient,
  orgUnitId: string,
): Promise<Array<MembershipResponse> | undefined> {
  const key = orgUnitsQueryKeys.memberships(orgUnitId);
  await queryClient.cancelQueries({ queryKey: key });
  return queryClient.getQueryData<Array<MembershipResponse>>(key);
}

/** Shared onError rollback for both membership hooks below. */
function rollbackMemberships(
  queryClient: QueryClient,
  orgUnitId: string,
  previousMemberships: Array<MembershipResponse> | undefined,
): void {
  if (previousMemberships) {
    queryClient.setQueryData(
      orgUnitsQueryKeys.memberships(orgUnitId),
      previousMemberships,
    );
  }
}

async function onMutateChangeMembershipRole(
  queryClient: QueryClient,
  variables: ChangeMembershipRoleInput,
) {
  const previousMemberships = await cancelAndSnapshotMemberships(
    queryClient,
    variables.orgUnitId,
  );
  if (previousMemberships) {
    queryClient.setQueryData<Array<MembershipResponse>>(
      orgUnitsQueryKeys.memberships(variables.orgUnitId),
      previousMemberships.map((membership) =>
        membership.userId === variables.userId
          ? { ...membership, role: variables.role }
          : membership,
      ),
    );
  }
  return { previousMemberships };
}

export function useChangeMembershipRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: orgUnitsMutationKeys.changeRole(),
    scope: { id: "org-unit-memberships" },
    mutationFn: changeMembershipRole,
    onMutate: (variables) =>
      onMutateChangeMembershipRole(queryClient, variables),
    onError: (_error, variables, context) =>
      rollbackMemberships(
        queryClient,
        variables.orgUnitId,
        context?.previousMemberships,
      ),
    onSuccess: (_data, { orgUnitId }) => {
      // The caller may have changed their OWN role — refresh "my role here" too.
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.myRole(orgUnitId),
      });
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.memberships(variables.orgUnitId),
      });
    },
  });
}

export type RevokeMembershipInput = { orgUnitId: string; userId: string };

export async function revokeMembership(
  input: RevokeMembershipInput,
): Promise<void> {
  await withOrgUnitsErrors(() =>
    revokeOrgUnitMembership(
      input.orgUnitId,
      input.userId,
      undefined,
      authenticatedFetch(),
    ),
  );
}

async function onMutateRevokeMembership(
  queryClient: QueryClient,
  variables: RevokeMembershipInput,
) {
  const previousMemberships = await cancelAndSnapshotMemberships(
    queryClient,
    variables.orgUnitId,
  );
  if (previousMemberships) {
    queryClient.setQueryData<Array<MembershipResponse>>(
      orgUnitsQueryKeys.memberships(variables.orgUnitId),
      previousMemberships.filter(
        (membership) => membership.userId !== variables.userId,
      ),
    );
  }
  return { previousMemberships };
}

export function useRevokeMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: orgUnitsMutationKeys.revoke(),
    scope: { id: "org-unit-memberships" },
    mutationFn: revokeMembership,
    onMutate: (variables) => onMutateRevokeMembership(queryClient, variables),
    onError: (_error, variables, context) =>
      rollbackMemberships(
        queryClient,
        variables.orgUnitId,
        context?.previousMemberships,
      ),
    onSuccess: (_data, { orgUnitId }) => {
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.myRole(orgUnitId),
      });
      // Self-leave can make the unit disappear from the visible list.
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.lists(),
      });
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: orgUnitsQueryKeys.memberships(variables.orgUnitId),
      });
    },
  });
}
