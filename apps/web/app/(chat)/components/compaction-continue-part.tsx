"use client";

import { LayersIcon } from "lucide-react";

import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@workspace/ui/components/marker";

/**
 * The `compaction` continue item on the message that resumes a Run after a
 * step-boundary compaction: a muted notice that the context above it was
 * compacted and the Run continues. The quoted request and the stored `text`
 * are model context and never render.
 *
 * @summary marks where a Run continued after a compaction
 */
export function CompactionContinuePart() {
  return (
    <Marker variant="border" className="my-1">
      <MarkerIcon>
        <LayersIcon aria-hidden="true" />
      </MarkerIcon>
      <MarkerContent>Context compacted. Continuing.</MarkerContent>
    </Marker>
  );
}
