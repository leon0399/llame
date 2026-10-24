import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import type {
  CreateChatMessageDto,
  CreateChatRequest,
  CreationWorkspaceResponse,
} from "../../api/generated/models";
import { createChat as createChatEndpoint } from "../../api/generated/chats/chats";
import { getApiErrorInfo } from "../../api/errors";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import type {
  StartLocationIsolation,
  StartLocationSelection,
  WorkspaceFailure,
} from "../project/start-location";
import { startLocationQueryKeys } from "../project/start-location";
import { projectQueryKeys } from "../project/queries";
import { chatQueryKeys } from "./queries";

/*
 * `POST /api/v1/chats` from the composer (openspec `chat-start-location`,
 * design D9/D10): one call creates the chat filed into its project, resolves
 * and binds the location, and starts the first Run. The composer keeps the
 * draft on a Workspace failure, because the server stores no message in that
 * case and a resend with the same chat id retries the location steps.
 */

/** What the composer holds when it submits: the location and the message. */
export type CreateChatDraft = {
  chatId: string;
  messageId: string;
  projectId?: string;
  selection: StartLocationSelection;
  isolation: StartLocationIsolation;
  worktree: { name?: string; baseRef?: string };
  message: {
    parts: CreateChatMessageDto["parts"];
    modelId: string;
    effort?: string;
    permissionMode?: CreateChatMessageDto["permissionMode"];
  };
};

function worktreeFields(worktree: {
  name?: string;
  baseRef?: string;
}): NonNullable<CreateChatRequest["worktree"]> {
  const name = worktree.name?.trim() ?? "";
  const baseRef = worktree.baseRef?.trim() ?? "";
  return {
    ...(name.length > 0 && { name }),
    ...(baseRef.length > 0 && { baseRef }),
  };
}

/**
 * The request the server validates. A blank base ref or name is omitted rather
 * than sent as `""` (the API rejects a blank value), and `worktree` is present
 * only when the composer asks for one — the request's `worktree` field is what
 * decides the outcome.
 */
export function buildCreateChatRequest(
  draft: CreateChatDraft,
): CreateChatRequest {
  const { effort, permissionMode } = draft.message;
  return {
    id: draft.chatId,
    ...(draft.projectId !== undefined && { projectId: draft.projectId }),
    ...(draft.selection.repositoryId !== undefined && {
      repositoryId: draft.selection.repositoryId,
    }),
    ...(draft.selection.executorId !== undefined && {
      executorId: draft.selection.executorId,
    }),
    ...(draft.selection.checkoutId !== undefined && {
      checkoutId: draft.selection.checkoutId,
    }),
    ...(draft.isolation === "worktree" && {
      worktree: worktreeFields(draft.worktree),
    }),
    message: {
      id: draft.messageId,
      parts: draft.message.parts,
      modelId: draft.message.modelId,
      ...(effort !== undefined && effort.length > 0 && { effort }),
      ...(permissionMode === "bypass" && { permissionMode }),
    },
  };
}

/** The failure the response names, or null when the Workspace is usable. */
export function workspaceFailure(
  workspace: CreationWorkspaceResponse,
): WorkspaceFailure | null {
  switch (workspace.status) {
    case "bound":
    case "unbound":
      return null;
    default:
      return { status: workspace.status, message: workspace.message };
  }
}

const failureEnvelope = z.object({ message: z.string().trim().min(1) });

/** The server's refusal sentence, or a fallback for a transport failure. */
export function createChatFailureMessage(error: unknown): string {
  const parsed = failureEnvelope.safeParse(getApiErrorInfo(error));
  return parsed.success
    ? parsed.data.message
    : "The chat could not be created. Try again.";
}

export function useCreateChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateChatRequest) =>
      createChatEndpoint(
        request,
        undefined,
        createAuthenticatedBrowserFetch(globalThis.fetch),
      ),
    onSuccess: () => {
      // A successful start writes the link's defaults row for the executor,
      // and a new open chat changes the preview's `clone_in_use` reason.
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: projectQueryKeys.repositoryLinks(),
      });
      queryClient.invalidateQueries({ queryKey: startLocationQueryKeys.all });
    },
  });
}
