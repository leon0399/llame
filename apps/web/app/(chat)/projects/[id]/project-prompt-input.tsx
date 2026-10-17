"use client";

import { SendIcon } from "lucide-react";

import { ComposerTooltip } from "../../components/composer-tooltip";
import {
  PromptInput,
  PromptInputButton,
  PromptInputTextarea,
  PromptInputToolbar,
} from "../../components/prompt-input";

/**
 * The project page's prompt input, shown but not yet usable: a new chat
 * started here should be created already filed into the project.
 *
 * TODO(#1328): send from here — create the chat with its `projectId` in one
 * step (never unfiled first), then open it like the new-chat page does.
 */
export function ProjectPromptInput({ projectName }: { projectName: string }) {
  return (
    <PromptInput onSubmit={(event) => event.preventDefault()}>
      <PromptInputTextarea
        placeholder={`New chat in ${projectName}`}
        aria-label={`New chat in ${projectName} — coming soon`}
        disabled
      />
      <PromptInputToolbar>
        <div className="ml-auto">
          {/* Focusable while disabled, so its tooltip still says why. */}
          <ComposerTooltip
            label="Send — coming soon"
            render={
              <PromptInputButton
                variant="ghost"
                size="icon"
                type="button"
                aria-label="Send — coming soon"
                disabled
                focusableWhenDisabled
              />
            }
          >
            <SendIcon size={16} />
          </ComposerTooltip>
        </div>
      </PromptInputToolbar>
    </PromptInput>
  );
}
