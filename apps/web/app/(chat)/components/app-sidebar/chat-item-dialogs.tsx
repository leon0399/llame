"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
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

function RenameChatDialogFooter({
  onCancel,
  onSubmit,
  submitDisabled,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitDisabled: boolean;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button onClick={onSubmit} disabled={submitDisabled}>
        Save
      </Button>
    </DialogFooter>
  );
}

type RenameChatDialogProps = {
  chat: Chat;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** The field state and submit mutation — split out from `RenameChatDialog`
 *  so that component composes only markup. */
function useRenameChatSubmit(chat: Chat, open: boolean, onSaved: () => void) {
  const rename = useRenameChat();
  const [title, setTitle] = useState(chat.title);

  // Reset the field to the current title each time the dialog opens.
  useEffect(() => {
    if (open) setTitle(chat.title);
  }, [open, chat.title]);

  const submit = () => {
    const next = title.trim();
    if (!next || next === chat.title) {
      onSaved();
      return;
    }
    rename.mutate({ id: chat.id, title: next }, { onSuccess: onSaved });
  };

  return { title, setTitle, submit, isPending: rename.isPending };
}

export function RenameChatDialog({
  chat,
  open,
  onOpenChange,
}: RenameChatDialogProps) {
  const { title, setTitle, submit, isPending } = useRenameChatSubmit(
    chat,
    open,
    () => onOpenChange(false),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename chat</DialogTitle>
        </DialogHeader>
        <RenameChatField
          title={title}
          onTitleChange={setTitle}
          onSubmit={submit}
        />
        <RenameChatDialogFooter
          onCancel={() => onOpenChange(false)}
          onSubmit={submit}
          submitDisabled={!title.trim() || isPending}
        />
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
