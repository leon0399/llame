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
  ComposerAddMenu,
  ComposerAttachmentRow,
  dropFilesInto,
  pasteFilesInto,
} from "./composer-attachments";
import { ComposerTooltip } from "./composer-tooltip";
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
      variant="ghost"
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
    <ComposerTooltip
      label="Stop generation"
      render={
        <PromptInputButton
          type="button"
          variant="ghost"
          size="icon"
          onClick={onStop}
          aria-label="Stop generation"
        />
      }
    >
      <StopCircleIcon size={16} />
    </ComposerTooltip>
  );
}

function SendButton({ modelReadyForSend }: { modelReadyForSend: boolean }) {
  return (
    <ComposerTooltip
      label="Send message"
      shortcut="Enter"
      render={
        <PromptInputButton
          variant="ghost"
          size="icon"
          type="submit"
          aria-label="Send message"
          disabled={!modelReadyForSend}
        />
      }
    >
      <SendIcon size={16} />
    </ComposerTooltip>
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

/** The row under the input card: the permission mode on the left, the model
 *  and its effort on the right, as small ghost buttons. Outside the form, so
 *  their popups are not part of the message being composed. */
function ChatComposerSettingsRow({ chatId }: { chatId: string }) {
  return (
    <div className="mt-1.5 flex items-center gap-2 px-1.5">
      <PermissionModeSelector chatId={chatId} />
      {/* One group, so the pair reads as a single setting: the two ghost
          fills join with squared inner corners, as one hover block. */}
      <ButtonGroup className="ml-auto">
        <ModelSelector />
        {/* Only present when the selected model declares an effort
            vocabulary; the group collapses to one cell when it renders
            nothing. */}
        <EffortSelector />
      </ButtonGroup>
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
  "status" | "onStop" | "modelReadyForSend" | "pendingStop" | "attachments"
>;

/** The toolbar under the textarea: the `+` menu on the left, send/stop on
 *  the right. */
function ChatComposerToolbar({
  status,
  onStop,
  modelReadyForSend,
  pendingStop,
  attachments,
}: ChatComposerToolbarProps) {
  return (
    <PromptInputToolbar>
      <ComposerAddMenu
        onFiles={attachments.add}
        accept={attachments.accept}
        attachDisabled={attachments.attachDisabled}
      />
      <div className="ml-auto">
        <ChatComposerSendButton
          status={status}
          onStop={onStop}
          modelReadyForSend={modelReadyForSend}
          pendingStop={pendingStop}
        />
      </div>
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
  chatId,
  ...toolbar
}: ChatComposerFormProps) {
  return (
    <fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0">
      <PromptInput
        onSubmit={preventWhenDisabled(disabled, onSubmit)}
        {...dropFilesInto(attachments.add)}
      >
        <ComposerAttachmentRow attachments={attachments} />
        {/* Remount on unlock so autofocus applies (attr updates do not). */}
        <PromptInputTextarea
          key={disabled ? "locked" : "ready"}
          name="message"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onPaste={pasteFilesInto(attachments.add)}
          placeholder="Describe a task or ask a question"
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
          attachments={attachments}
        />
      </PromptInput>
      <ChatComposerSettingsRow chatId={chatId} />
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
  /** Images and PDFs attached to the unsent message. */
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
    // `pb-1.5` matches the settings row's `mt-1.5`, so the row sits evenly
    // between the input card and the page edge.
    <div className="bg-background z-10 shrink-0 px-3 pb-1.5 md:px-5">
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
