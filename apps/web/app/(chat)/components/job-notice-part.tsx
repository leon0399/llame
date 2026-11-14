"use client";

import type { UIMessage } from "ai";
import { TerminalIcon } from "lucide-react";

import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@workspace/ui/components/marker";

import {
  jobNoticeParts,
  type JobNoticePart as JobNotice,
} from "@/lib/services/chat/job-notice";
import { isHostMessageMetadata } from "@/lib/services/chat/history";

/** A host-authored settlement notice, deliberately separate from message
 *  bubbles and owner actions. Only the public locator and state are shown. */
export function JobNoticePart({ notice }: { notice: JobNotice }) {
  return (
    <Marker variant="border" className="my-1">
      <MarkerIcon>
        <TerminalIcon aria-hidden="true" />
      </MarkerIcon>
      <MarkerContent>
        {notice.data.payload.locator} {notice.data.payload.state}
      </MarkerContent>
    </Marker>
  );
}

/** Render only validated job notices from the host-authored user row. */
export function HostJobNotices({ message }: { message: UIMessage }) {
  const { metadata } = message;

  if (message.role !== "user" || !isHostMessageMetadata(metadata)) return null;

  return jobNoticeParts(message).map((notice, index) => (
    <JobNoticePart
      key={`${notice.data.payload.locator}-${index}`}
      notice={notice}
    />
  ));
}
