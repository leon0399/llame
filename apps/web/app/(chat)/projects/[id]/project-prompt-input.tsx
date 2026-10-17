"use client";

import { useState } from "react";

import { ChatComposerBody } from "../../components/chat-composer";
import { useComposerAttachments } from "../../components/use-composer-attachments";

/**
 * The project page's prompt input: the new-chat page's own composer — input,
 * attachments, permission mode, model and effort — shown but locked, since a
 * chat started here must be created already filed into the project.
 *
 * TODO(#1328): unlock it and send from here — create the chat with its
 * `projectId` in one step (never unfiled first), then open it like the
 * new-chat page does.
 */
export function ProjectPromptInput({ projectId }: { projectId: string }) {
  const [input, setInput] = useState("");
  const attachments = useComposerAttachments();

  return (
    <ChatComposerBody
      // A key for this page's composer settings (permission mode), not a
      // chat: no chat exists until the first send.
      chatId={`project:${projectId}`}
      input={input}
      onInputChange={setInput}
      onSubmit={(event) => event.preventDefault()}
      status="ready"
      onStop={() => {}}
      modelReadyForSend={false}
      modelSendUnavailableReason={null}
      disabled
      attachments={attachments}
    />
  );
}
