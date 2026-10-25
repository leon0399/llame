import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import type {
  CreateChatMessageDto,
  CreateChatRequest,
  CreationWorkspaceResponse,
} from "../../api/generated/models";
import { createChat as createChatEndpoint } from "../../api/generated/chats/chats";
import { getApiErrorInfo, getApiErrorStatus } from "../../api/errors";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import { checkoutQueryKeys } from "../checkouts/queries";
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
  message: {
    parts: CreateChatMessageDto["parts"];
    modelId: string;
    effort?: string;
    permissionMode?: CreateChatMessageDto["permissionMode"];
  };
};

/**
 * The request the server validates. `worktree` is present only when the
 * composer asks for one, as an empty object: the server names the worktree
 * and cuts it from the source checkout. The location is opt-in: an empty
 * selection binds none.
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
    ...(draft.isolation === "worktree" && { worktree: {} }),
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

/**
 * True when the create route refused because the Chat already holds a message.
 *
 * That refusal is the server's answer to a resend whose first request did reach
 * it: the draft is filed, so the composer treats it as sent rather than sending
 * a duplicate through the message route.
 */
export function chatAlreadyHoldsMessage(error: unknown): boolean {
  const info = failureEnvelope.partial().safeParse(getApiErrorInfo(error));
  return (
    getApiErrorStatus(error) === 409 &&
    info.success &&
    info.data.message?.includes("already holds a message") === true
  );
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
      // A bound start also moves the checkout rows: a worktree start records
      // the new row, and a reused clone gains this chat in its `chatIds`. The
      // session details and the project's worktree list read them, so a stale
      // list leaves the new worktree unnameable until a reload.
      queryClient.invalidateQueries({ queryKey: checkoutQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: projectQueryKeys.repositoryLinks(),
      });
      queryClient.invalidateQueries({ queryKey: startLocationQueryKeys.all });
    },
  });
}
