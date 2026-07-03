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
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Switch } from "@workspace/ui/components/switch";

import { copyText } from "@/lib/clipboard";
import {
  useDeleteChat,
  useRenameChat,
  useSetChatVisibility,
} from "@/lib/services/chat/management";

const TITLE_MAX = 200;

type Chat = { id: string; title: string };
type ShareableChat = Chat & { visibility: "private" | "public" };

export function ShareChatDialog({
  chat,
  open,
  onOpenChange,
}: {
  chat: ShareableChat;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setVisibility = useSetChatVisibility();
  const [copied, setCopied] = useState(false);
  const isPublic = chat.visibility === "public";
  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/shared/${chat.id}`
      : `/shared/${chat.id}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share chat</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Public link</p>
            <p className="text-muted-foreground text-xs">
              Anyone with the link can view this chat (read-only). Your thinking
              and other chats stay private.
            </p>
          </div>
          <Switch
            checked={isPublic}
            disabled={setVisibility.isPending}
            aria-label="Share publicly"
            onCheckedChange={(next) =>
              setVisibility.mutate({
                id: chat.id,
                visibility: next ? "public" : "private",
              })
            }
          />
        </div>
        {isPublic && (
          <div className="flex gap-2">
            <Input
              readOnly
              value={link}
              aria-label="Share link"
              className="text-xs"
              onFocus={(e) => e.target.select()}
            />
            <Button
              size="sm"
              variant="outline"
              aria-label="Copy link"
              onClick={async () => {
                if (await copyText(link)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
            >
              {copied ? (
                <CheckIcon className="size-4" />
              ) : (
                <CopyIcon className="size-4" />
              )}
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
          <Button
            onClick={submit}
            disabled={!title.trim() || rename.isPending}
          >
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
