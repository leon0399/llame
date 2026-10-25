import * as React from "react";

import type { FileUIPart } from "ai";
import { useRouter } from "next/navigation";

import { useChatContext, type PermissionMode } from "@/contexts/chat-context";
import type {
  CreateChatMessageDto,
  CreateChatRequest,
} from "@/lib/api/generated/models";
import {
  buildCreateChatRequest,
  chatAlreadyHoldsMessage,
  createChatFailureMessage,
  useCreateChat,
  workspaceFailure,
} from "@/lib/services/chat/creation";
import type { WorkspaceFailure } from "@/lib/services/project/start-location";
import type { StartLocationPrefill } from "@/lib/services/project/start-location-link";
import { safeRandomUUID } from "@/lib/uuid";

import {
  attachmentFileParts,
  revokePreviews,
  type ComposerAttachments,
} from "./use-composer-attachments";
import { useChatModelSelection } from "./use-chat-engine";
import {
  useComposerLocation,
  type ComposerLocation,
} from "./use-composer-location";

/*
 * The send of a chat filed into a project (openspec `chat-start-location`,
 * design D9/D10): one `POST /api/v1/chats` creates the chat in the project,
 * binds the location the row under the input shows, and starts the first Run.
 * The project page and the bare new-chat page with a project chosen both send
 * through it.
 */

type ComposerSelections = {
  modelId: string | undefined;
  effort: string | undefined;
  permissionMode: PermissionMode;
  modelReadyForSend: boolean;
  modelSendUnavailableReason: string | null;
};

/** The composer's model, effort, and permission mode (keyed by its settings
 *  id until a chat exists). */
function useComposerSelections(composerChatId: string): ComposerSelections {
  const { selectedModel, setSelectedModel, selectedEffort, getPermissionMode } =
    useChatContext();
  const { modelReadyForSend, modelSendUnavailableReason } =
    useChatModelSelection(selectedModel, setSelectedModel);
  return {
    modelId: selectedModel,
    effort: selectedEffort,
    permissionMode: getPermissionMode(composerChatId),
    modelReadyForSend,
    modelSendUnavailableReason,
  };
}

type CreateRequestInput = {
  text: string;
  files: Array<FileUIPart>;
  chatId: string;
  /** The project the chat is filed into, or null for an unfiled chat. */
  projectId: string | null;
  location: ComposerLocation;
  selections: ComposerSelections;
};

/** The create request for the typed draft, or null when it cannot send. The
 *  location is opt-in: the request names the working directory the row shows,
 *  or none, so the server never binds a default the reader did not see. */
function createRequest(input: CreateRequestInput): CreateChatRequest | null {
  const { modelId, modelReadyForSend, effort, permissionMode } =
    input.selections;
  if (!modelReadyForSend || modelId === undefined) return null;
  if (input.text.length === 0 && input.files.length === 0) return null;
  const parts: CreateChatMessageDto["parts"] = [
    ...(input.text.length > 0
      ? [{ type: "text" as const, text: input.text }]
      : []),
    ...input.files,
  ];
  const checkout = input.location.location.checkout;
  return buildCreateChatRequest({
    chatId: input.chatId,
    messageId: safeRandomUUID(),
    ...(input.projectId !== null && { projectId: input.projectId }),
    selection:
      checkout === null
        ? {}
        : {
            repositoryId: checkout.repositoryId,
            executorId: checkout.executorId,
            checkoutId: checkout.id,
          },
    isolation: checkout === null ? "reuse" : input.location.isolation,
    // The server generates the worktree's branch from its source.
    worktree: {},
    message: { parts, modelId, effort, permissionMode },
  });
}

type SubmitArgs = {
  input: string;
  attachments: ComposerAttachments;
  createChat: ReturnType<typeof useCreateChat>;
  selections: ComposerSelections;
  location: ComposerLocation;
  projectId: string | null;
  retryChatId: string | null;
  /** Retain the id a submit allocated, before any request leaves the browser. */
  onRetain: (chatId: string) => void;
  onFailure: (message: string | null) => void;
  onWorkspaceFailure: (workspace: WorkspaceFailure, chatId: string) => void;
  onSent: (chatId: string) => void;
};

async function sendCreate(
  args: SubmitArgs,
  request: CreateChatRequest,
  chatId: string,
) {
  try {
    const response = await args.createChat.mutateAsync(request);
    const workspace = workspaceFailure(response.workspace);
    if (workspace === null) {
      args.onSent(response.chat.id);
      return;
    }
    args.onWorkspaceFailure(
      {
        ...workspace,
        executorId:
          request.executorId ??
          args.location.location.executor?.executorId ??
          undefined,
      },
      chatId,
    );
  } catch (error) {
    // The Chat exists and already holds this draft's message, so the earlier
    // request did reach the server: the draft is filed, and a second send would
    // duplicate it.
    if (chatAlreadyHoldsMessage(error)) {
      args.onSent(chatId);
      return;
    }
    args.onFailure(createChatFailureMessage(error));
  }
}

/**
 * The submit handler — split out as a plain factory, so it calls no hooks. The
 * Chat id is allocated once per draft and retained before the request, so a
 * lost response cannot mint a second Chat on the next submit.
 */
export function createSubmitHandler(args: SubmitArgs) {
  return (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (args.createChat.isPending || args.attachments.sendBlocked) return;
    const text = args.input.trim();
    const files = attachmentFileParts(args.attachments.items);
    const chatId = args.retryChatId ?? safeRandomUUID();
    const request = createRequest({
      text,
      files,
      chatId,
      projectId: args.projectId,
      location: args.location,
      selections: args.selections,
    });
    if (request === null) return;
    args.onFailure(null);
    args.onRetain(chatId);
    void sendCreate(args, request, chatId);
  };
}

/** The chat a Workspace failure left filed and unbound, for its project (the
 *  empty string for an unfiled chat). */
type RetryChat = { projectId: string; chatId: string };

type ChatCreationArgs = {
  /** The project the chat is filed into, or null for an unfiled chat. */
  projectId: string | null;
  /** The composer's settings id, for the permission mode until a chat exists. */
  composerChatId: string;
  input: string;
  setInput: (value: string) => void;
  attachments: ComposerAttachments;
  /** The deep link's or entry point's pre-fill. */
  initial?: StartLocationPrefill | null;
  /** False for a chat that already exists: it creates nothing and reads nothing. */
  enabled?: boolean;
};

export type ChatCreation = {
  /** A project or a working directory is chosen, so the send must create. */
  active: boolean;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  /** The failed create's sentence, shown above the input until corrected. */
  failure: string | null;
  pending: boolean;
  location: ComposerLocation;
  modelReadyForSend: boolean;
  modelSendUnavailableReason: string | null;
};

/**
 * The last create attempt: its failed sentence, the Workspace status the row
 * shows, and the chat it left filed and unbound, which a resend reuses.
 */
function useCreationAttempt() {
  const [failure, setFailure] = React.useState<string | null>(null);
  const [workspaceFailed, setWorkspaceFailure] =
    React.useState<WorkspaceFailure | null>(null);
  const [retry, setRetry] = React.useState<RetryChat | null>(null);
  return {
    failure,
    setFailure,
    workspaceFailed,
    retryChatId: (projectId: string) =>
      retry?.projectId === projectId ? retry.chatId : null,
    retain: (projectId: string, chatId: string) =>
      setRetry({ projectId, chatId }),
    // The next draft starts from a new id.
    forget: () => setRetry(null),
    failWorkspace: (workspace: WorkspaceFailure) => {
      setWorkspaceFailure(workspace);
      setFailure(workspace.message ?? "The Workspace could not be prepared.");
    },
    clear: () => {
      setFailure(null);
      setWorkspaceFailure(null);
    },
  };
}

/** After a create: the draft is the chat now, so the composer empties and the
 *  page opens the chat. */
function useOpenCreatedChat(args: ChatCreationArgs, forget: () => void) {
  const router = useRouter();
  return (chatId: string) => {
    const sent = args.attachments.items;
    forget();
    args.setInput("");
    args.attachments.clear();
    revokePreviews(sent);
    router.push(`/chat/${chatId}`);
  };
}

/**
 * The create's send, for a chat with a project or a working directory. A
 * `workspace` failure stores the chat and no message: the draft stays and the
 * same chat id is resent, which retries the location steps. A transport error
 * keeps the draft too, with the server's own sentence. A retry belongs to its
 * project, so another project starts anew.
 */
export function useChatCreation(args: ChatCreationArgs): ChatCreation {
  const createChat = useCreateChat();
  const selections = useComposerSelections(args.composerChatId);
  const attempt = useCreationAttempt();
  const openCreated = useOpenCreatedChat(args, attempt.forget);
  const { projectId } = args;
  const location = useComposerLocation({
    projectId,
    failed: attempt.workspaceFailed,
    initial: args.initial,
    enabled: args.enabled,
    // Editing the location corrects the draft, so the warning goes away.
    onChange: attempt.clear,
  });
  const active = projectId !== null || location.location.checkout !== null;
  const retryKey = projectId ?? "";
  const onSubmit: React.FormEventHandler<HTMLFormElement> = (event) =>
    createSubmitHandler({
      ...args,
      createChat,
      selections,
      location,
      retryChatId: attempt.retryChatId(retryKey),
      onRetain: (chatId) => attempt.retain(retryKey, chatId),
      onFailure: attempt.setFailure,
      onWorkspaceFailure: (workspace, chatId) => {
        attempt.retain(retryKey, chatId);
        attempt.failWorkspace(workspace);
      },
      onSent: openCreated,
    })(event);
  return {
    active,
    onSubmit,
    failure: active ? attempt.failure : null,
    pending: createChat.isPending,
    location,
    modelReadyForSend: selections.modelReadyForSend,
    modelSendUnavailableReason: selections.modelSendUnavailableReason,
  };
}
