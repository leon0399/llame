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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readNumber(value: unknown): number | undefined {
  if (!isFiniteNumber(value)) return undefined;
  return value;
}

/** Non-null-object guard; the object's actual shape is unknown to this file. */
function isPlainObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** The subset of a `data-cap-notice` part's fields this file reads, still unvalidated. */
type RawCapNoticePart = {
  data?: unknown;
  stepsUsed?: unknown;
  maxSteps?: unknown;
};

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
  if (!isPlainObject(part)) return null;
  // SAFETY: `RawCapNoticePart` only names the fields read below, each still
  // `unknown` and independently guarded (`readNumber`/`isPlainObject`).
  const record = part as RawCapNoticePart;

  let nested: { stepsUsed?: unknown; maxSteps?: unknown } | undefined;
  if (isPlainObject(record.data)) {
    // SAFETY: `isPlainObject` proves `record.data` is a non-null object only;
    // `stepsUsed`/`maxSteps` stay `unknown` and are guarded by `readNumber`.
    nested = record.data as { stepsUsed?: unknown; maxSteps?: unknown };
  }

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
      Tool step limit reached ({stepsUsed}/{maxSteps}) — answered with what it
      had
    </Badge>
  );
}
