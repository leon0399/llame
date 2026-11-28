import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  createKnowledgeSpace as createKnowledgeSpaceEndpoint,
  updateKnowledgeSpace as updateKnowledgeSpaceEndpoint,
} from "../../api/generated/knowledge/knowledge";
import type { KnowledgeSpaceResponse } from "../../api/generated/models";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import { toast } from "@workspace/ui/components/sonner";
import { knowledgeSpaceQueryKeys } from "./queries";

function authenticatedFetch(): typeof fetch {
  return createAuthenticatedBrowserFetch(globalThis.fetch);
}

function refreshKnowledgeSpaces(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: knowledgeSpaceQueryKeys.lists(),
  });
}

/** Create a Knowledge Space. The name may duplicate another Space. */
export async function createKnowledgeSpace(
  name: string,
): Promise<KnowledgeSpaceResponse> {
  return createKnowledgeSpaceEndpoint(
    { name },
    undefined,
    authenticatedFetch(),
  );
}

export function useCreateKnowledgeSpace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createKnowledgeSpace,
    onSuccess: () => refreshKnowledgeSpaces(queryClient),
    onError: () => toast.error("Couldn't create the Knowledge Space."),
  });
}

/** Rename one Knowledge Space. An archived Space is refused by the API. */
export async function renameKnowledgeSpace(
  id: string,
  name: string,
): Promise<KnowledgeSpaceResponse> {
  return updateKnowledgeSpaceEndpoint(
    id,
    { name },
    undefined,
    authenticatedFetch(),
  );
}

export function useRenameKnowledgeSpace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameKnowledgeSpace(id, name),
    onSuccess: () => refreshKnowledgeSpaces(queryClient),
    onError: () => toast.error("Couldn't rename the Knowledge Space."),
  });
}

/** Archive or unarchive one Knowledge Space. Files on disk stay in place. */
export async function setKnowledgeSpaceArchive(
  id: string,
  archived: boolean,
): Promise<KnowledgeSpaceResponse> {
  return updateKnowledgeSpaceEndpoint(
    id,
    { archived },
    undefined,
    authenticatedFetch(),
  );
}

export function useSetKnowledgeSpaceArchive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      setKnowledgeSpaceArchive(id, archived),
    onSuccess: () => refreshKnowledgeSpaces(queryClient),
    onError: (_error, { archived }) =>
      toast.error(
        archived
          ? "Couldn't archive the Knowledge Space."
          : "Couldn't unarchive the Knowledge Space.",
      ),
  });
}
