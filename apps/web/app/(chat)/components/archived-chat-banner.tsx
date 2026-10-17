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

/** Whether the open chat is archived. Uses the same query keys as the chat
 *  header's `useOpenChat`, so it adds no request only while that header is
 *  mounted; elsewhere it fetches the lists, then GET /chats/:id (a 404 for a
 *  draft, which is never archived). */
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
