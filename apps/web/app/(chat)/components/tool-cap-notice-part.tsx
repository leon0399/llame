"use client";

import { InfoIcon } from "lucide-react";

import { Badge } from "@workspace/ui/components/badge";

/**
 * The parsed payload of a `data-cap-notice` part. AI SDK v6's `DataUIPart<T>`
 * shape nests the payload under `.data`
 * (`{ type: "data-cap-notice", id?, data: { stepsUsed, maxSteps } }`) — see
 * `parseCapNoticePart` for why a flat fallback is also accepted.
 */
export type CapNoticeData = { stepsUsed: number; maxSteps: number };

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Extracts `{ stepsUsed, maxSteps }` from a `data-cap-notice` part. Reads
 * the SDK-native nested `part.data.{stepsUsed,maxSteps}` shape first, and
 * falls back to top-level fields on the part itself — design.md D6 requires
 * the step cap stay VISIBLE to the user, so a silent shape mismatch here
 * would defeat the entire requirement; tolerating both plausible wire
 * shapes is cheaper than a renderer that silently shows nothing. Returns
 * `null` (render nothing) only when neither shape yields both numbers.
 */
export function parseCapNoticePart(part: unknown): CapNoticeData | null {
  if (typeof part !== "object" || part === null) return null;
  const record = part as Record<string, unknown>;
  const nested =
    typeof record.data === "object" && record.data !== null
      ? (record.data as Record<string, unknown>)
      : undefined;
  const stepsUsed = readNumber(nested?.stepsUsed ?? record.stepsUsed);
  const maxSteps = readNumber(nested?.maxSteps ?? record.maxSteps);
  if (stepsUsed === undefined || maxSteps === undefined) return null;
  return { stepsUsed, maxSteps };
}

/**
 * The step-cap notice (design.md D6): a small, always-visible inline chip
 * shown when a run hits `tools.maxStepsPerRun` and the model was driven to
 * answer from accumulated context instead of calling further tools.
 * "Degraded behavior must be visible" — this renders straight from the
 * persisted `data-cap-notice` part, so live and historical reload show the
 * identical chip (spec's "Step-cap notice is visible in the UI"
 * requirement).
 */
export function ToolCapNoticePart({ stepsUsed, maxSteps }: CapNoticeData) {
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground my-1 gap-1 font-normal"
    >
      <InfoIcon className="h-3 w-3 shrink-0" />
      Tool step limit reached ({stepsUsed}/{maxSteps}) — answered with what
      it had
    </Badge>
  );
}
