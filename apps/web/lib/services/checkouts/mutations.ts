import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { CheckoutResponse } from "../../api/generated/models";
import {
  registerCheckout as registerCheckoutEndpoint,
  removeCheckoutWorktree as removeCheckoutWorktreeEndpoint,
} from "../../api/generated/checkouts/checkouts";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import { projectQueryKeys } from "../project/queries";
import { repositoryQueryKeys } from "../repositories/queries";

import { checkoutQueryKeys } from "./queries";

function authenticatedFetch(): typeof fetch {
  return createAuthenticatedBrowserFetch(globalThis.fetch);
}

/*
 * Checkout writes: registration and guarded worktree removal. Both callers
 * render the server's typed refusal inline (the dialog, or the worktree row),
 * so these hooks do not add a second, generic toast — the refusal sentence is
 * the one a reader needs, and a toast behind a dialog's scrim would be the
 * wrong place for it.
 */

/**
 * What the registration form collects: the path, and optionally the repository
 * or the remote that selects one. The executor is not a field — the route
 * derives it from the path itself, a plain path being this instance's local
 * executor and `machine://<name>/…` naming a Machine.
 */
export type RegisterCheckoutInput = {
  path: string;
  repositoryId?: string;
  remote?: string;
};

export async function registerCheckout(
  input: RegisterCheckoutInput,
): Promise<CheckoutResponse> {
  return registerCheckoutEndpoint(
    {
      path: input.path,
      repositoryId: input.repositoryId,
      remote: input.remote,
    },
    undefined,
    authenticatedFetch(),
  );
}

export function useRegisterCheckout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: registerCheckout,
    onSuccess: () => {
      // Registration can adopt a repository it has not seen and record a
      // worktree under its main clone, so both reads move.
      queryClient.invalidateQueries({ queryKey: checkoutQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: repositoryQueryKeys.list() });
    },
  });
}

/** The guarded removal: the route refuses a dirty tree or unpushed commits. */
export async function removeCheckoutWorktree(id: string): Promise<void> {
  await removeCheckoutWorktreeEndpoint(id, undefined, authenticatedFetch());
}

export function useRemoveCheckoutWorktree() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeCheckoutWorktree,
    onSuccess: () => {
      // Dropping a checkout also drops any project defaults that named it.
      queryClient.invalidateQueries({ queryKey: checkoutQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: projectQueryKeys.repositoryLinks(),
      });
    },
  });
}
