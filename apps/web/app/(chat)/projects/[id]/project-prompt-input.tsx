"use client";

import * as React from "react";

import type { StartLocationPrefill } from "@/lib/services/project/start-location-link";

import { ChatComposerBody } from "../../components/chat-composer";
import { useChatCreation } from "../../components/use-chat-creation";
import { useComposerAttachments } from "../../components/use-composer-attachments";

/**
 * The project page's prompt input: the new-chat page's own composer — input,
 * attachments, permission mode, model and effort — filed into this project,
 * which the chip beside `+` names and the page does not let it change. The
 * send creates the chat in the project, bound to the location the row under
 * the input shows when the project has a repository (design D10, #1328).
 */
export function ProjectPromptInput({
  projectId,
  projectName,
  initial = null,
}: {
  projectId: string;
  projectName: string;
  /** The deep link's or entry point's pre-fill; the page keys the composer by it. */
  initial?: StartLocationPrefill | null;
}) {
  const composerChatId = `project:${projectId}`;
  const [input, setInput] = React.useState("");
  const attachments = useComposerAttachments();
  const creation = useChatCreation({
    projectId,
    composerChatId,
    input,
    setInput,
    attachments,
    initial,
  });
  return (
    // The create supplies the send, its failure, the location, and the
    // model's readiness.
    <ChatComposerBody
      {...creation}
      chatId={composerChatId}
      input={input}
      onInputChange={setInput}
      status="ready"
      onStop={() => {}}
      disabled={creation.pending}
      attachments={attachments}
      project={{
        projects: [],
        selected: { id: projectId, name: projectName },
        onSelect: () => {},
        locked: true,
      }}
    />
  );
}
