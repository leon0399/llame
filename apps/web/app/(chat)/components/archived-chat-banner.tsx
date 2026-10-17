"use client";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { ArchiveIcon } from "lucide-react";

import { useSetChatArchive } from "@/lib/services/chat/management";
import { useOpenChat } from "@/lib/services/chat/queries";

/** Whether the open chat is archived. Shares the chat header's queries (list
 *  caches, or GET /chats/:id), so it adds no request — and a draft, which no
 *  cache holds, is never archived. */
export function useOpenChatArchived(chatId: string): boolean {
  const chat = useOpenChat(chatId);
  return chat !== undefined && chat.archivedAt !== null;
}

/** Above the locked composer of an archived chat: why it is read-only, and
 *  the one action that makes it writable again. */
export function ArchivedChatBanner({ chatId }: { chatId: string }) {
  const archive = useSetChatArchive();
  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-2 md:px-5">
      <Alert>
        <ArchiveIcon />
        <AlertTitle>This chat is archived</AlertTitle>
        <AlertDescription>
          It can&apos;t receive new messages until you unarchive it.
        </AlertDescription>
        <AlertAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={archive.isPending}
            onClick={() => archive.mutate({ id: chatId, archived: false })}
          >
            Unarchive
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
