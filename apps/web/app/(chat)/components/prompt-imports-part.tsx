"use client";

import { AtSignIcon } from "lucide-react";

import type { PromptImportsPayload } from "@/lib/services/chat/history";

import {
  ContextChipGroup,
  ContextFileChip,
  type ContextFileState,
} from "./context-file-chip";

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
        const state: ContextFileState =
          entry.outcome === "imported" && entry.truncated
            ? "truncated"
            : entry.outcome;
        const detail =
          entry.resolved !== undefined && entry.resolved !== entry.locator
            ? `${entry.locator} → ${entry.resolved}`
            : undefined;

        return (
          <ContextFileChip
            key={`import:${entry.locator}`}
            kind="prompt"
            path={entry.locator}
            detail={detail}
            state={state}
          />
        );
      })}
      {(payload.omitted ?? []).map((locator) => (
        <ContextFileChip
          key={`omitted:${locator}`}
          kind="prompt"
          path={locator}
          state="omitted"
        />
      ))}
    </ContextChipGroup>
  );
}
