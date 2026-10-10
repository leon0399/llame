"use client";

import type { ChatStatus } from "ai";
import { LoaderCircleIcon, SendIcon, StopCircleIcon } from "lucide-react";

import { ButtonGroup } from "@workspace/ui/components/button-group";

import { EffortSelector } from "./effort-selector";
import { ModelSelector } from "./model-selector";
import { PermissionModeSelector } from "./permission-mode-selector";
import {
  PromptInput,
  PromptInputButton,
  PromptInputTextarea,
  PromptInputToolbar,
} from "./prompt-input";
import {
  AttachImagesButton,
  ComposerAttachmentRow,
  dropImagesInto,
  pasteImagesInto,
} from "./composer-attachments";
import type { ComposerAttachments } from "./use-composer-attachments";

type ChatComposerSendButtonProps = {
  status: ChatStatus;
  onStop: () => void;
  modelReadyForSend: boolean;
  /** Held Stop before the Run id arrives (design M2/M3 S4). */
  pendingStop: boolean;
};

function StoppingButton() {
  return (
    <PromptInputButton
      type="button"
      variant="outline"
      size="icon"
      disabled
      aria-label="Stopping generation"
    >
      <LoaderCircleIcon size={16} className="animate-spin" />
    </PromptInputButton>
  );
}

function StopButton({ onStop }: { onStop: () => void }) {
  return (
    <PromptInputButton
      type="button"
      variant="outline"
      size="icon"
      onClick={onStop}
      aria-label="Stop generation"
    >
      <StopCircleIcon size={16} />
    </PromptInputButton>
  );
}

function SendButton({ modelReadyForSend }: { modelReadyForSend: boolean }) {
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

/** The send affordance, swapped for a stop control while a turn is in
 *  flight. S1–S3 show an enabled Stop icon; S4 shows a disabled spinner
 *  while a held Stop waits for the Run id (design M3). */
function ChatComposerSendButton({
  status,
  onStop,
  modelReadyForSend,
  pendingStop,
}: ChatComposerSendButtonProps) {
  if (pendingStop) {
    return <StoppingButton />;
  }
  if (status === "streaming" || status === "submitted") {
    return <StopButton onStop={onStop} />;
  }
  return <SendButton modelReadyForSend={modelReadyForSend} />;
}

type ChatComposerControlsProps = {
  status: ChatStatus;
  onStop: () => void;
  modelReadyForSend: boolean;
  pendingStop: boolean;
};

/** The toolbar's right-side cluster: the model/effort selectors and the
 *  send/stop affordance. Split out of `ChatComposer` as its own
 *  self-contained control. */
function ChatComposerControls({
  status,
  onStop,
  modelReadyForSend,
  pendingStop,
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
        pendingStop={pendingStop}
      />
    </div>
  );
}

type ChatComposerFormProps = {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  status: ChatStatus;
  onStop: () => void;
  modelReadyForSend: boolean;
  pendingStop: boolean;
  disabled: boolean;
  chatId: string;
  attachments: ComposerAttachments;
};

function preventWhenDisabled(
  disabled: boolean,
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void,
) {
  return (event: React.FormEvent<HTMLFormElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onSubmit(event);
  };
}

type ChatComposerToolbarProps = Pick<
  ChatComposerFormProps,
  "status" | "onStop" | "modelReadyForSend" | "pendingStop" | "chatId"
> & { onAttachFiles: (files: Iterable<File>) => void };

/** The toolbar under the textarea: the image picker and permission mode on
 *  the left, the model/effort selectors and send/stop on the right. */
function ChatComposerToolbar({
  status,
  onStop,
  modelReadyForSend,
  pendingStop,
  chatId,
  onAttachFiles,
}: ChatComposerToolbarProps) {
  return (
    <PromptInputToolbar>
      <div className="flex items-center gap-1">
        <AttachImagesButton onFiles={onAttachFiles} />
        <PermissionModeSelector chatId={chatId} />
      </div>
      <ChatComposerControls
        status={status}
        onStop={onStop}
        modelReadyForSend={modelReadyForSend}
        pendingStop={pendingStop}
      />
    </PromptInputToolbar>
  );
}

/** Prompt chrome locked via fieldset while markdown chunks load. */
function ChatComposerForm({
  input,
  onInputChange,
  onSubmit,
  modelReadyForSend,
  disabled,
  attachments,
  ...toolbar
}: ChatComposerFormProps) {
  return (
    <fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0">
      <PromptInput
        onSubmit={preventWhenDisabled(disabled, onSubmit)}
        {...dropImagesInto(attachments.add)}
      >
        <ComposerAttachmentRow attachments={attachments} />
        {/* Remount on unlock so autofocus applies (attr updates do not). */}
        <PromptInputTextarea
          key={disabled ? "locked" : "ready"}
          name="message"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onPaste={pasteImagesInto(attachments.add)}
          placeholder="What would you like to know?"
          disabled={disabled}
          // Deliberate: chat page sole purpose is this composer.
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={!disabled}
        />
        <ChatComposerToolbar
          {...toolbar}
          modelReadyForSend={
            modelReadyForSend && !disabled && !attachments.sendBlocked
          }
          onAttachFiles={attachments.add}
        />
      </PromptInput>
    </fieldset>
  );
}

type ChatComposerProps = {
  chatId: string;
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  status: ChatStatus;
  onStop: () => void;
  modelReadyForSend: boolean;
  modelSendUnavailableReason: string | null;
  /** Held Stop before the Run id arrives (design M2/M3 S4). */
  pendingStop?: boolean;
  /** Whole composer locked (e.g. markdown renderers still loading). */
  disabled?: boolean;
  /** Images attached to the unsent message. */
  attachments: ComposerAttachments;
};

/** The bottom composer bar: the message textarea, model/effort selectors,
 *  and the send/stop affordance. Split out of `ChatSessionContent` as its
 *  own self-contained region. */
export function ChatComposer({
  chatId,
  input,
  onInputChange,
  onSubmit,
  status,
  onStop,
  modelReadyForSend,
  modelSendUnavailableReason,
  pendingStop = false,
  disabled = false,
  attachments,
}: ChatComposerProps) {
  const unavailableReason =
    modelSendUnavailableReason ?? attachments.blockReason;
  return (
    <div className="bg-background z-10 shrink-0 px-3 pb-3 md:px-5 md:pb-5">
      <div className="mx-auto max-w-3xl">
        {unavailableReason && (
          <p className="mb-2 text-xs text-destructive">{unavailableReason}</p>
        )}
        <ChatComposerForm
          chatId={chatId}
          input={input}
          onInputChange={onInputChange}
          onSubmit={onSubmit}
          status={status}
          onStop={onStop}
          modelReadyForSend={modelReadyForSend}
          pendingStop={pendingStop}
          disabled={disabled}
          attachments={attachments}
        />
      </div>
    </div>
  );
}
