"use client";

import { RefreshCwIcon } from "lucide-react";

import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@workspace/ui/components/marker";

import type { RegenerateNoticePart as RegenerateNoticePartData } from "@/lib/services/chat/history";

/** The owner-facing sentence for each reason the api records. The stored
 *  `text` is the model's `<system-reminder>` envelope, which never renders. */
const NOTICE_TEXT: Record<
  RegenerateNoticePartData["data"]["payload"]["reason"],
  string
> = {
  non_read_only_calls:
    "An earlier attempt at this turn was discarded after it ran tools whose effects stay.",
};

/**
 * The `regenerate` context item on its user message (turn-actions D9/D13): a
 * quiet notice that the answer the owner is looking at replaced an attempt
 * whose tool effects remain. It reuses the transcript's context-item styling —
 * the same muted marker row the model-switch context item uses — so it reads
 * as server-authored context, not as something the owner wrote.
 *
 * @summary marks a user turn whose earlier attempt was discarded
 */
export function RegenerateNoticePart({
  payload,
}: {
  payload: RegenerateNoticePartData["data"]["payload"];
}) {
  return (
    <Marker variant="border" className="my-1">
      <MarkerIcon>
        <RefreshCwIcon aria-hidden="true" />
      </MarkerIcon>
      <MarkerContent>{NOTICE_TEXT[payload.reason]}</MarkerContent>
    </Marker>
  );
}
