"use client";

import type { UIMessage } from "ai";
import { TerminalIcon } from "lucide-react";

import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@workspace/ui/components/marker";

import { isCompactionContinuePart } from "@/lib/services/chat/compaction-continue";
import {
  isJobNoticePart,
  type JobNoticePart as JobNotice,
} from "@/lib/services/chat/job-notice";
import { CompactionContinuePart } from "./compaction-continue-part";
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

/** Render only validated job notices and the compaction continue notice
 *  from the host-authored user row, in stored order. */
export function HostJobNotices({ message }: { message: UIMessage }) {
  const { metadata } = message;

  if (message.role !== "user" || !isHostMessageMetadata(metadata)) return null;

  return message.parts.map((part, index) => {
    if (isCompactionContinuePart(part)) {
      return <CompactionContinuePart key={index} />;
    }

    return isJobNoticePart(part) ? (
      <JobNoticePart key={index} notice={part} />
    ) : null;
  });
}
