import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useOptionalLiveUpdates } from "@/contexts/live-updates-context";
import {
  listChatJobs,
  readChatJobOutput,
  stopChatJob,
} from "../../api/generated/chats/chats";
import { ChangeChatJobDtoState } from "../../api/generated/models";
import type { ChatJobResponse } from "../../api/generated/models";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

export const chatJobsQueryKeys = {
  all: ["chat-jobs"] as const,
  chat: (chatId: string) => [...chatJobsQueryKeys.all, chatId] as const,
};

const JOBS_POLL_MS = 4000;

export function chatJobsQueryOptions(chatId: string, liveConnected: boolean) {
  return queryOptions({
    queryKey: chatJobsQueryKeys.chat(chatId),
    queryFn: ({ signal }) =>
      listChatJobs(
        chatId,
        { signal },
        createAuthenticatedBrowserFetch(globalThis.fetch),
      ),
    // `chat.upserted` refreshes this cache while connected. Poll only when
    // the live connection is absent; the hook is enabled only while open.
    refetchInterval: liveConnected ? false : JOBS_POLL_MS,
  });
}

export function isLiveChatJob(job: ChatJobResponse): boolean {
  return job.state === "running";
}

export function useChatJobs(chatId: string, enabled: boolean) {
  const liveConnected = useOptionalLiveUpdates()?.connected ?? false;

  return useQuery({
    ...chatJobsQueryOptions(chatId, liveConnected),
    enabled,
    refetchIntervalInBackground: true,
  });
}

/**
 * A settled job's stored output. It never changes once the job settles, so
 * it is read once, when the owner first opens the job, and kept.
 */
export function useChatJobOutput(
  chatId: string,
  jobId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["chat-job-output", chatId, jobId] as const,
    queryFn: ({ signal }) =>
      readChatJobOutput(
        chatId,
        jobId,
        { signal },
        createAuthenticatedBrowserFetch(globalThis.fetch),
      ),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useStopChatJobs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      chatId,
      jobIds,
    }: {
      chatId: string;
      jobIds: Array<string>;
    }) => {
      const fetchFn = createAuthenticatedBrowserFetch(globalThis.fetch);
      const request = { state: ChangeChatJobDtoState.cancelled };

      return Promise.all(
        jobIds.map((jobId) =>
          stopChatJob(chatId, jobId, request, undefined, fetchFn),
        ),
      );
    },
    onSettled: (_jobs, _error, { chatId }) =>
      queryClient.invalidateQueries({
        queryKey: chatJobsQueryKeys.chat(chatId),
      }),
  });
}
