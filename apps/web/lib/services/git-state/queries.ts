import { useQuery } from "@tanstack/react-query";

import { getChatGitState } from "../../api/generated/chats/chats";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

export type {
  GitStateNotARepositoryResponse,
  GitStateOkResponse,
  GitStateUnavailableResponse,
  GitStateUnboundResponse,
} from "../../api/generated/models";

export const gitStateQueryKeys = {
  all: ["git-state"] as const,
  // The root is part of the key so a re-bound Chat never shows the old
  // Workspace's state.
  detail: (chatId: string, workspaceRoot: string) =>
    [...gitStateQueryKeys.all, chatId, workspaceRoot] as const,
};

/** The live repository state of the Chat's Workspace binding. */
export async function fetchChatGitState(chatId: string) {
  return getChatGitState(
    chatId,
    undefined,
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
}

/**
 * Read while the Session details panel is open on a bound Chat. The state
 * changes outside llame, so it is always stale: opening the panel and
 * focusing the window read it again. It is never polled.
 */
export function useChatGitStateQuery(
  chatId: string,
  workspaceRoot: string | null,
  panelOpen: boolean,
) {
  return useQuery({
    queryKey: gitStateQueryKeys.detail(chatId, workspaceRoot ?? ""),
    queryFn: () => fetchChatGitState(chatId),
    enabled: panelOpen && workspaceRoot !== null,
    staleTime: 0,
  });
}
