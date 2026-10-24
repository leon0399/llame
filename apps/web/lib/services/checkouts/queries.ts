import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { CheckoutResponse } from "../../api/generated/models";
import { listCheckouts } from "../../api/generated/checkouts/checkouts";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

export type { CheckoutResponse };

/**
 * The checkout list's only server filter. A worktree listing reads the whole
 * list and narrows it to the project's linked repositories, so one request
 * covers every link instead of one per link.
 */
export type CheckoutListFilters = { repositoryId?: string };

export const checkoutQueryKeys = {
  all: ["checkouts"] as const,
  lists: () => [...checkoutQueryKeys.all, "list"] as const,
  list: (filters?: CheckoutListFilters) =>
    filters?.repositoryId === undefined
      ? checkoutQueryKeys.lists()
      : ([...checkoutQueryKeys.lists(), filters] as const),
};

/**
 * Every checkout of the caller: each `main` clone and each `worktree`, with
 * the ids of the chats bound to its path and, for a worktree, the chat whose
 * lease records it.
 */
export async function fetchCheckouts(
  filters?: CheckoutListFilters,
): Promise<Array<CheckoutResponse>> {
  return listCheckouts(
    filters,
    undefined,
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
}

/** The state a checkout-list reader holds: pending, failed, or the rows. */
export type CheckoutsQuery = UseQueryResult<Array<CheckoutResponse>>;

export function useCheckoutsQuery(
  filters?: CheckoutListFilters,
  enabled = true,
): CheckoutsQuery {
  return useQuery({
    queryKey: checkoutQueryKeys.list(filters),
    queryFn: () => fetchCheckouts(filters),
    enabled,
  });
}
