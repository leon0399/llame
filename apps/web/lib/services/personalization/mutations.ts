import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updatePersonalization as updatePersonalizationEndpoint } from "../../api/generated/personalization/personalization";
import type {
  PersonalizationResponse,
  UpdatePersonalizationDto,
} from "../../api/generated/models";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import { personalizationQueryKeys } from "./queries";
import type { PersonalizationUpdate } from "./types";

export const personalizationMutationKeys = {
  all: ["personalization", "mutations"] as const,
  update: () => [...personalizationMutationKeys.all, "update"] as const,
};

function authenticatedFetch(): typeof fetch {
  return createAuthenticatedBrowserFetch(globalThis.fetch);
}

export async function updatePersonalization(
  input: PersonalizationUpdate,
): Promise<PersonalizationResponse> {
  // The generated request model currently describes nullable strings as
  // objects, while the API runtime accepts string|null. The feature facade
  // keeps the correct runtime shape and narrows at this generated boundary.
  return updatePersonalizationEndpoint(
    input as UpdatePersonalizationDto,
    undefined,
    authenticatedFetch(),
  );
}

/**
 * Follows the repo's documented mutation discipline (see the reference note in
 * `services/org-units/mutations.ts`): cancel in-flight queries for the affected
 * key → snapshot → patch → roll back on error → always invalidate on settle.
 *
 * Patched optimistically because the next state IS computable here: the server
 * assigns nothing the client cannot predict, so the toggles flip instantly
 * rather than waiting a round trip to answer a switch the user just clicked.
 */
export function useUpdatePersonalizationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: personalizationMutationKeys.update(),
    // Serialized: every control on the settings form shares this mutation, so
    // without a scope two rapid toggle clicks run concurrently and whichever
    // PATCH the server commits LAST wins — which is not necessarily the last
    // one clicked. A shared scope id makes them run one after another, so
    // last-click-wins holds.
    scope: { id: "personalization" },
    mutationFn: updatePersonalization,
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: personalizationQueryKeys.mine(),
      });
      const previous = queryClient.getQueryData<PersonalizationResponse>(
        personalizationQueryKeys.mine(),
      );
      if (previous) {
        queryClient.setQueryData<PersonalizationResponse>(
          personalizationQueryKeys.mine(),
          { ...previous, ...input },
        );
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          personalizationQueryKeys.mine(),
          context.previous,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: personalizationQueryKeys.mine(),
      });
    },
  });
}
