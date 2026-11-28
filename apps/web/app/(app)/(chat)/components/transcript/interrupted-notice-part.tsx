"use client";

import { HandIcon } from "lucide-react";

import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@workspace/ui/components/marker";

/**
 * The `interrupted` context item on a delivered user message (run-steering):
 * a muted notice that the owner stopped the previous step, so the reply above
 * it ends where the interrupt cut it. The stored `text` is the model's
 * `<system-reminder>` envelope and never renders.
 *
 * @summary marks the message that interrupted the reply above it
 */
export function InterruptedNoticePart() {
  return (
    <Marker variant="border" className="my-1">
      <MarkerIcon>
        <HandIcon aria-hidden="true" />
      </MarkerIcon>
      <MarkerContent>
        You interrupted the previous step. Its response stopped before it was
        complete.
      </MarkerContent>
    </Marker>
  );
}
