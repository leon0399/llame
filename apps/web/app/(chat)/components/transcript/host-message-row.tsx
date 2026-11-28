import type { ReactNode } from "react";
import type { UIMessage } from "ai";

import { HostJobNotices } from "./job-notice-part";

import { messageSeqFromMetadata } from "@/lib/services/chat/history";

/** Host-authored rows contain server-rendered notices, not owner actions. */
export function HostMessageRow({
  message,
  renderKey,
  boundary,
  modelBoundary,
}: {
  message: UIMessage;
  renderKey: string;
  boundary: ReactNode;
  modelBoundary: ReactNode;
}) {
  const messageSeq = messageSeqFromMetadata(message.metadata);

  return (
    <>
      {boundary}
      {modelBoundary}
      <div
        id={messageSeq === null ? undefined : `msg-${messageSeq}`}
        data-message-key={renderKey}
      >
        <HostJobNotices message={message} />
      </div>
    </>
  );
}
