"use client";

import { CheckIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";

import { ModEnterKbd, useModEnterAria } from "@/components/mod-enter-submit";

/** The three save-outcome messages are independent, not mutually exclusive — an
 * over-cap draft and a stale save error can be true at once. */
function PersonalizationSaveStatus({
  dirty,
  overCap,
  isError,
}: {
  dirty: boolean;
  overCap: boolean;
  isError: boolean;
}) {
  return (
    <>
      {dirty && !overCap ? (
        <span className="text-sm text-muted-foreground">Unsaved changes</span>
      ) : null}
      {overCap ? (
        <span className="text-sm text-destructive">
          Too long to save — trim the fields marked above.
        </span>
      ) : null}
      {isError ? (
        <span className="text-sm text-destructive">
          Could not save. Try again.
        </span>
      ) : null}
    </>
  );
}

export function PersonalizationSaveRow({
  canSave,
  dirty,
  overCap,
  isSaving,
  isError,
  onSave,
}: {
  canSave: boolean;
  dirty: boolean;
  isSaving: boolean;
  overCap: boolean;
  isError: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex w-full items-center gap-3">
      <p className="mr-auto min-w-0 text-sm">
        <PersonalizationSaveStatus
          dirty={dirty}
          overCap={overCap}
          isError={isError}
        />
      </p>
      <Button
        size="sm"
        onClick={onSave}
        disabled={!canSave}
        aria-keyshortcuts={useModEnterAria()}
      >
        {/* The label never changes. Swapping "Save"→"Saving…" reflows the
            button mid-click; only the icon morphs, and both glyphs are
            size-4, so nothing moves. */}
        {isSaving ? <Spinner /> : <CheckIcon className="size-4" aria-hidden />}
        Save
        <ModEnterKbd />
      </Button>
    </div>
  );
}
