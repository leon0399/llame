"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";

import { useDeleteChat, useRenameChat } from "@/lib/services/chat/management";

const TITLE_MAX = 200;

type Chat = { id: string; title: string };

export function RenameChatDialog({
  chat,
  open,
  onOpenChange,
}: {
  chat: Chat;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rename = useRenameChat();
  const [title, setTitle] = useState(chat.title);

  // Reset the field to the current title each time the dialog opens.
  useEffect(() => {
    if (open) setTitle(chat.title);
  }, [open, chat.title]);

  const submit = () => {
    const next = title.trim();
    if (!next || next === chat.title) {
      onOpenChange(false);
      return;
    }
    rename.mutate(
      { id: chat.id, title: next },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename chat</DialogTitle>
        </DialogHeader>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={TITLE_MAX}
          aria-label="Chat title"
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!title.trim() || rename.isPending}>
            Save
          </Button>
        </DialogFooter>
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
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete chat?</AlertDialogTitle>
          <AlertDialogDescription>
            “{chat.title}” and all of its messages will be permanently deleted.
            This can’t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
