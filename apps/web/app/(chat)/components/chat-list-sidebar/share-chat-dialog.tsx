"use client";

import { useEffect, useState } from "react";

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
import { useSetChatVisibility } from "@/lib/services/chat/management";

type ShareableChat = {
  id: string;
  visibility: "private" | "public";
};

/**
 * Toggle a chat public/private + copy its read-only share link. The chat
 * dropdown's "Share" action opens this (see chat-list.tsx). Toggling is
 * owner-only (`PATCH /chats/:id`, RLS `chats_owner`); the link only ever
 * resolves via the api's `@Public` `/shared/chats/:id` + the SELECT-only
 * `*_public_read` policies gated on `visibility = 'public'`.
 */
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
  // While the toggle mutation is in flight, reflect its target value instead
  // of the (stale, pre-refetch) `chat.visibility` prop — otherwise the switch
  // visually snaps back/stays put until the chat-list query settles.
  const isPublic = setVisibility.isPending
    ? setVisibility.variables?.visibility === "public"
    : chat.visibility === "public";
  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/shared/${chat.id}`
      : `/shared/${chat.id}`;

  // A stale "copied" checkmark from a previous link must not survive into a
  // reopened dialog or a different chat's share link.
  useEffect(() => {
    if (open) {
      setCopied(false);
    }
  }, [open, chat.id]);

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
