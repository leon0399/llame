"use client";

import { useState } from "react";

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
import { ComposerLocationPill } from "./composer-location-pill";
import {
  type ComposerProject,
  ComposerProjectChip,
  ComposerProjectSubmenu,
} from "./composer-project";
import { ComposerTooltip } from "./composer-tooltip";
import {
  ComposerWorkingDirectorySubmenu,
  OtherFolderDialog,
} from "./composer-working-directory";
import type { ComposerAttachments } from "./use-composer-attachments";
import type { ComposerLocation } from "./use-composer-location";

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
  project: ComposerProject | undefined;
  location: ComposerLocation | undefined;
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
  | "status"
  | "onStop"
  | "modelReadyForSend"
  | "pendingStop"
  | "attachments"
  | "project"
  | "location"
> & {
  /** The whole composer is locked: no upload, by menu or by shortcut. */
  locked: boolean;
};

/** The working-directory pill and the typed-folder dialog its menus open. */
function ComposerLocationChip({
  location,
  otherFolder,
  onOtherFolderChange,
}: {
  location: ComposerLocation;
  otherFolder: boolean;
  onOtherFolderChange: (open: boolean) => void;
}) {
  return (
    <>
      <ComposerLocationPill
        location={location}
        onOtherFolder={() => onOtherFolderChange(true)}
      />
      <OtherFolderDialog
        open={otherFolder}
        onOpenChange={onOtherFolderChange}
        location={location}
      />
    </>
  );
}

/** The toolbar's left side: the `+` menu with its project and working
 *  directory items, then the project and working-directory chips. */
function ComposerToolbarStart({
  attachments,
  project,
  location,
  locked,
}: Pick<
  ChatComposerToolbarProps,
  "attachments" | "project" | "location" | "locked"
>) {
  const [otherFolder, setOtherFolder] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <ComposerAddMenu
        onFiles={attachments.add}
        accept={attachments.accept}
        attachDisabled={attachments.attachDisabled || locked}
      >
        {project === undefined ? null : (
          <ComposerProjectSubmenu project={project} />
        )}
        {location === undefined ? null : (
          <ComposerWorkingDirectorySubmenu
            location={location}
            onOtherFolder={() => setOtherFolder(true)}
          />
        )}
      </ComposerAddMenu>
      {project === undefined ? null : <ComposerProjectChip project={project} />}
      {location === undefined ? null : (
        <ComposerLocationChip
          location={location}
          otherFolder={otherFolder}
          onOtherFolderChange={setOtherFolder}
        />
      )}
    </div>
  );
}

/** The toolbar under the textarea: the `+` menu and the project chip on the
 *  left, send/stop on the right. */
function ChatComposerToolbar({
  status,
  onStop,
  modelReadyForSend,
  pendingStop,
  ...start
}: ChatComposerToolbarProps) {
  return (
    <PromptInputToolbar>
      <ComposerToolbarStart {...start} />
      <div className="ml-auto">
        <ChatComposerSendButton
          status={status}
          onStop={onStop}
          modelReadyForSend={
            modelReadyForSend && !start.locked && !start.attachments.sendBlocked
          }
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
  disabled,
  attachments,
  chatId,
  location,
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
          attachments={attachments}
          location={location}
          locked={disabled}
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
  /** The project the chat is filed into, with the `+` menu's way to change
   *  it; absent where the composer cannot file a chat. */
  project?: ComposerProject;
  /** The filed chat's start location, for the row under the input. */
  location?: ComposerLocation;
  /** A failed create's sentence; the draft stays for a resend. */
  failure?: string | null;
};

/** A failed create's sentence, then why the model cannot send, if either. */
function ComposerNotices({
  failure,
  unavailableReason,
}: {
  failure: string | null;
  unavailableReason: string | null;
}) {
  return (
    <>
      {failure === null ? null : (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {failure}
        </p>
      )}
      {unavailableReason && (
        <p className="mb-2 text-xs text-destructive">{unavailableReason}</p>
      )}
    </>
  );
}

/** The composer itself — the message textarea, attachments, permission mode,
 *  model/effort selectors and the send/stop affordance — with no placement
 *  of its own, so a page can set it into its own layout (the project page
 *  sets it into a column). */
export function ChatComposerBody({
  modelSendUnavailableReason,
  pendingStop = false,
  disabled = false,
  project,
  location,
  failure = null,
  ...form
}: ChatComposerProps) {
  return (
    <>
      <ComposerNotices
        failure={failure}
        unavailableReason={
          modelSendUnavailableReason ?? form.attachments.blockReason
        }
      />
      <ChatComposerForm
        {...form}
        pendingStop={pendingStop}
        disabled={disabled}
        project={project}
        location={location}
      />
    </>
  );
}

/** The chat page's bottom composer bar: `ChatComposerBody` docked at the
 *  foot of the transcript, centred to the reading width. */
export function ChatComposer(props: ChatComposerProps) {
  return (
    // `pb-1.5` matches the settings row's `mt-1.5`, so the row sits evenly
    // between the input card and the page edge.
    <div className="bg-background z-10 shrink-0 px-3 pb-1.5 md:px-5">
      <div className="mx-auto max-w-3xl">
        <ChatComposerBody {...props} />
      </div>
    </div>
  );
}
