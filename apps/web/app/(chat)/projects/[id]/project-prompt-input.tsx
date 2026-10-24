"use client";

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
  createChatFailureMessage,
  useCreateChat,
  workspaceFailure,
} from "@/lib/services/chat/creation";
import type { WorkspaceFailure } from "@/lib/services/project/start-location";
import { safeRandomUUID } from "@/lib/uuid";

import { ChatComposerBody } from "../../components/chat-composer";
import { LocationChip } from "../../components/location-chip";
import {
  useComposerLocation,
  type ComposerLocation,
} from "../../components/use-composer-location";
import {
  attachmentFileParts,
  revokePreviews,
  type ComposerAttachments,
  useComposerAttachments,
} from "../../components/use-composer-attachments";
import { useChatModelSelection } from "../../components/use-chat-engine";

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
  projectId: string;
  location: ComposerLocation;
  selections: ComposerSelections;
};

/** The create request for the typed draft, or null when it cannot send. */
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
  return buildCreateChatRequest({
    chatId: input.chatId,
    messageId: safeRandomUUID(),
    projectId: input.projectId,
    selection: input.location.selection,
    isolation: input.location.isolation,
    worktree: {
      name: input.location.worktreeName,
      baseRef: input.location.baseRef,
    },
    message: { parts, modelId, effort, permissionMode },
  });
}

type SubmitArgs = {
  input: string;
  attachments: ComposerAttachments;
  createChat: ReturnType<typeof useCreateChat>;
  selections: ComposerSelections;
  location: ComposerLocation;
  projectId: string;
  retryChatId: string | null;
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
    args.onFailure(createChatFailureMessage(error));
  }
}

/** The submit handler — split out as a plain factory, so it calls no hooks. */
function createSubmitHandler(args: SubmitArgs) {
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
    void sendCreate(args, request, chatId);
  };
}

/** The composer's own state, plus the resolved location the chip edits. */
type ProjectDraft = {
  input: string;
  setInput: (value: string) => void;
  failure: string | null;
  setFailure: (message: string | null) => void;
  workspaceFailed: WorkspaceFailure | null;
  setWorkspaceFailure: (failure: WorkspaceFailure | null) => void;
  retryChatId: string | null;
  setRetryChatId: (chatId: string) => void;
  location: ComposerLocation;
};

function useProjectDraft(projectId: string, projectName: string): ProjectDraft {
  const [input, setInput] = React.useState("");
  const [failure, setFailure] = React.useState<string | null>(null);
  const [workspaceFailed, setWorkspaceFailure] =
    React.useState<WorkspaceFailure | null>(null);
  // The chat a workspace failure left filed and unbound; a resend reuses it.
  const [retryChatId, setRetryChatId] = React.useState<string | null>(null);
  const location = useComposerLocation({
    projectId,
    projectName,
    failed: workspaceFailed,
    // Editing the location corrects the draft, so the failed create's warning
    // goes away with its retry identity.
    onChange: () => {
      setFailure(null);
      setWorkspaceFailure(null);
    },
  });
  return {
    input,
    setInput,
    failure,
    setFailure,
    workspaceFailed,
    setWorkspaceFailure,
    retryChatId,
    setRetryChatId,
    location,
  };
}

/** The submit handler, with the two outcomes a create can have. */
function useProjectSubmit(args: {
  projectId: string;
  draft: ProjectDraft;
  attachments: ComposerAttachments;
  createChat: ReturnType<typeof useCreateChat>;
  selections: ComposerSelections;
}) {
  const router = useRouter();
  const { draft } = args;
  return createSubmitHandler({
    input: draft.input,
    attachments: args.attachments,
    createChat: args.createChat,
    selections: args.selections,
    location: draft.location,
    projectId: args.projectId,
    retryChatId: draft.retryChatId,
    onFailure: (message) => {
      draft.setFailure(message);
    },
    onWorkspaceFailure: (workspace, chatId) => {
      draft.setRetryChatId(chatId);
      draft.setWorkspaceFailure(workspace);
      draft.setFailure(
        workspace.message ?? "The Workspace could not be prepared.",
      );
    },
    onSent: (chatId) => {
      const sent = args.attachments.items;
      draft.setInput("");
      args.attachments.clear();
      revokePreviews(sent);
      router.push(`/chat/${chatId}`);
    },
  });
}

type ProjectComposerProps = {
  body: React.ComponentProps<typeof ChatComposerBody>;
  failure: string | null;
  location: ComposerLocation;
};

/** The chip, the failure sentence, and the composer body. */
function ProjectComposer({ body, failure, location }: ProjectComposerProps) {
  return (
    <div className="flex min-w-0 flex-col">
      {failure === null ? null : (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {failure}
        </p>
      )}
      <LocationChip location={location} className="mb-1.5 self-start" />
      <ChatComposerBody {...body} />
    </div>
  );
}

/**
 * The project page's prompt input: the new-chat page's own composer — input,
 * attachments, permission mode, model and effort — and one send that calls
 * `POST /api/v1/chats` with this project, so the chat is created already filed
 * and bound to the location the chip shows (design D10, closing #1328).
 *
 * A `workspace` failure stores the chat and no message: the draft stays and the
 * same chat id is resent, which retries the location steps. A transport error
 * keeps the draft too, with the server's own sentence.
 */
export function ProjectPromptInput({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const composerChatId = `project:${projectId}`;
  const draft = useProjectDraft(projectId, projectName);
  const attachments = useComposerAttachments();
  const createChat = useCreateChat();
  const selections = useComposerSelections(composerChatId);
  const onSubmit = useProjectSubmit({
    projectId,
    draft,
    attachments,
    createChat,
    selections,
  });
  const body: React.ComponentProps<typeof ChatComposerBody> = {
    chatId: composerChatId,
    input: draft.input,
    onInputChange: draft.setInput,
    onSubmit,
    status: "ready",
    onStop: () => {},
    modelReadyForSend: selections.modelReadyForSend,
    modelSendUnavailableReason: selections.modelSendUnavailableReason,
    disabled: createChat.isPending,
    attachments,
  };
  return (
    <ProjectComposer
      body={body}
      failure={draft.failure}
      location={draft.location}
    />
  );
}
