"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { DialogSubmitFooter } from "@/components/dialog-submit-footer";
import { useDeleteChat, useRenameChat } from "@/lib/services/chat/management";

const TITLE_MAX = 200;

type Chat = { id: string; title: string };

type RenameChatFieldProps = {
  title: string;
  onTitleChange: (title: string) => void;
  onSubmit: () => void;
};

/** Split out from `RenameChatDialog` so that component composes only markup,
 *  not this field's own key-handling. */
function RenameChatField({
  title,
  onTitleChange,
  onSubmit,
}: RenameChatFieldProps) {
  return (
    <Input
      value={title}
      onChange={(e) => onTitleChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSubmit();
        }
      }}
      maxLength={TITLE_MAX}
      aria-label="Chat title"
      // Deliberate: WAI-ARIA dialog pattern moves focus into the modal on
      // open; this is the dialog's primary field.
      // oxlint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
    />
  );
}

type RenameChatDialogProps = {
  chat: Chat;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** The field state and submit mutation — split out from `RenameChatDialog`
 *  so that component composes only markup, and mounted with the dialog's
 *  content: the content unmounts while the dialog is closed, so each open
 *  re-seeds the field from the chat's current title. */
function RenameChatForm({
  chat,
  onSaved,
}: {
  chat: Chat;
  onSaved: () => void;
}) {
  const rename = useRenameChat();
  const [title, setTitle] = useState(chat.title);

  const submit = () => {
    const next = title.trim();
    if (!next || next === chat.title) {
      onSaved();
      return;
    }
    rename.mutate({ id: chat.id, title: next }, { onSuccess: onSaved });
  };

  return (
    <>
      <RenameChatField
        title={title}
        onTitleChange={setTitle}
        onSubmit={submit}
      />
      <DialogSubmitFooter
        onCancel={onSaved}
        onSubmit={submit}
        submitLabel="Save"
        submitDisabled={!title.trim() || rename.isPending}
      />
    </>
  );
}

export function RenameChatDialog({
  chat,
  open,
  onOpenChange,
}: RenameChatDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename chat</DialogTitle>
        </DialogHeader>
        <RenameChatForm chat={chat} onSaved={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function DeleteChatDialog({
  chat,
  isActive,
  open,
  onOpenChange,
}: {
  chat: Chat;
  isActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const del = useDeleteChat();
  const router = useRouter();

  const confirm = () => {
    // Navigate away FIRST when deleting the active chat, so its message-history
    // query unmounts before the DELETE lands — no refetch of a now-404 chat.
    if (isActive) router.push("/");
    del.mutate(chat.id, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete chat?"
      description={
        <>
          “{chat.title}” and all of its messages will be permanently deleted.
          This can’t be undone.
        </>
      }
      onConfirm={confirm}
      isPending={del.isPending}
    />
  );
}
