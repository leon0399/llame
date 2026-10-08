"use client";

import { AtSignIcon } from "lucide-react";

import type {
  PromptImportOutcome,
  PromptImportsPayload,
} from "@/lib/services/chat/history";

import { ContextChipGroup, ContextFileChip } from "./context-file-chip";

type PromptImportState = PromptImportOutcome | "truncated" | "omitted";

/**
 * The owner-facing chip for a `prompt-imports` context item: each import marker
 * a user prompt carried, marked when the result was truncated, denied by the
 * `read` permission group, failed to read, or omitted past a bound. The model
 * text names denied, failed, and omitted targets only as not imported; the
 * outcomes and resolved paths shown here are owner-only and never reach a
 * public share. It renders at the top of the triggering user turn, live and
 * reloaded alike.
 *
 * @summary owner chip for imported, truncated, denied, failed, and omitted prompt files
 */
export function PromptImportsPart(payload: PromptImportsPayload) {
  return (
    <ContextChipGroup icon={<AtSignIcon />} label="Imports">
      {payload.imports.map((entry) => {
        const state: PromptImportState =
          entry.outcome === "imported" && entry.truncated
            ? "truncated"
            : entry.outcome;
        const detail =
          entry.resolved !== undefined && entry.resolved !== entry.locator
            ? `${entry.locator} → ${entry.resolved}`
            : undefined;
        const muted = state !== "imported" && state !== "truncated";

        return (
          <ContextFileChip
            key={`import:${entry.locator}`}
            kind="prompt"
            path={entry.locator}
            detail={detail}
            state={state}
            muted={muted}
          />
        );
      })}
      {(payload.omitted ?? []).map((locator) => (
        <ContextFileChip
          key={`omitted:${locator}`}
          kind="prompt"
          path={locator}
          state="omitted"
          muted
        />
      ))}
    </ContextChipGroup>
  );
}
