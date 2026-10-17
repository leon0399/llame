"use client";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { ArchiveIcon } from "lucide-react";
import { usePathname } from "next/navigation";

import { useSetChatArchive } from "@/lib/services/chat/management";
import { useOpenChat } from "@/lib/services/chat/queries";

/** Whether the chat open at `/chat/:chatId` is archived. A draft that has
 *  no route yet is never archived, and resolving it would 404. */
export function useOpenChatArchived(chatId: string): boolean {
  const routed = usePathname() === `/chat/${chatId}`;
  const chat = useOpenChat(routed ? chatId : undefined);
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
