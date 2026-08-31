"use client";

import type { ChatStatus } from "ai";
import { LoaderCircleIcon, SendIcon, StopCircleIcon } from "lucide-react";

import { ButtonGroup } from "@workspace/ui/components/button-group";

import { EffortSelector } from "./effort-selector";
import { ModelSelector } from "./model-selector";
import {
  PromptInput,
  PromptInputButton,
  PromptInputTextarea,
  PromptInputToolbar,
} from "./prompt-input";

type ChatComposerSendButtonProps = {
  status: ChatStatus;
  onStop: () => void;
  modelReadyForSend: boolean;
};

/** The send affordance, swapped for a stop control while a turn is in
 *  flight. Split out of `ChatComposerControls` as its own self-contained
 *  control. */
function ChatComposerSendButton({
  status,
  onStop,
  modelReadyForSend,
}: ChatComposerSendButtonProps) {
  if (status === "streaming" || status === "submitted") {
    return (
      <PromptInputButton
        type="button"
        variant="outline"
        // size-8, the same box as the selector cells' h-8. Stated
        // through the API rather than a class override, and with
        // no corner overrides — Button's symmetric `rounded-lg` is
        // what makes the icon read centred.
        size="icon"
        onClick={onStop}
        aria-label="Stop generation"
      >
        {status === "submitted" ? (
          <LoaderCircleIcon size={16} className="animate-spin" />
        ) : (
          <StopCircleIcon size={16} />
        )}
      </PromptInputButton>
    );
  }
  return (
    <PromptInputButton
      variant="outline"
      size="icon"
      type="submit"
      aria-label="Send message"
      disabled={!modelReadyForSend}
    >
      <SendIcon size={16} />
    </PromptInputButton>
  );
}

type ChatComposerControlsProps = {
  status: ChatStatus;
  onStop: () => void;
  modelReadyForSend: boolean;
};

/** The toolbar's right-side cluster: the model/effort selectors and the
 *  send/stop affordance. Split out of `ChatComposer` as its own
 *  self-contained control. */
function ChatComposerControls({
  status,
  onStop,
  modelReadyForSend,
}: ChatComposerControlsProps) {
  return (
    // Two units, not one pill: the SELECTORS are attached to each other,
    // and send stands alone.
    //
    // Send left the group because being its last cell forced
    // `rounded-r-lg` with squared left corners, and a paper-plane glyph
    // reads off-centre inside an asymmetric box. Standalone, it keeps
    // Button's own all-round `rounded-lg` and the icon centres itself — a
    // shape fix rather than nudging the glyph.
    //
    // `gap-2` is the same 8px ButtonGroup applies between nested groups
    // (`has-[>[data-slot=button-group]]:gap-2`), so the separation is the
    // design system's answer, not a hand-picked number. Both units are
    // h-8, which that gap is scaled for.
    <div className="ml-auto flex items-center gap-2">
      <ButtonGroup>
        <ModelSelector />
        {/* Only present when the selected model declares an effort
            vocabulary; the group re-collapses to a single cell when
            it renders nothing. */}
        <EffortSelector />
      </ButtonGroup>
      <ChatComposerSendButton
        status={status}
        onStop={onStop}
        modelReadyForSend={modelReadyForSend}
      />
    </div>
  );
}

type ChatComposerProps = {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  status: ChatStatus;
  onStop: () => void;
  modelReadyForSend: boolean;
  modelSendUnavailableReason: string | null;
};

/** The bottom composer bar: the message textarea, model/effort selectors,
 *  and the send/stop affordance. Split out of `ChatSessionContent` as its
 *  own self-contained region. */
export function ChatComposer({
  input,
  onInputChange,
  onSubmit,
  status,
  onStop,
  modelReadyForSend,
  modelSendUnavailableReason,
}: ChatComposerProps) {
  return (
    <div className="bg-background z-10 shrink-0 px-3 pb-3 md:px-5 md:pb-5">
      <div className="mx-auto max-w-3xl">
        {modelSendUnavailableReason && (
          <p className="mb-2 text-xs text-destructive">
            {modelSendUnavailableReason}
          </p>
        )}
        <PromptInput onSubmit={onSubmit}>
          <PromptInputTextarea
            name="message"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder="What would you like to know?"
            // Deliberate: the chat page's sole purpose is this composer,
            // so autofocusing it on load matches established chat-UI
            // convention (this is not a modal interrupting other content).
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <PromptInputToolbar>
            <ChatComposerControls
              status={status}
              onStop={onStop}
              modelReadyForSend={modelReadyForSend}
            />
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </div>
  );
}
