"use client";

import { useId, useState } from "react";

import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Spinner } from "@workspace/ui/components/spinner";
import { Textarea } from "@workspace/ui/components/textarea";

import { useUpdateProject } from "@/lib/services/project/mutations";
import type { ProjectResponse } from "@/lib/services/project/types";

import { ProjectRepositoriesSection } from "./project-repositories-section";

// The API's cap, counted in Unicode code points — not UTF-16 units. The server
// counts every code point, including a variation selector, separately.
const INSTRUCTIONS_MAX = 16_000;

const INSTRUCTIONS_DISCLOSURE =
  "Applies to future Runs and is sent to your model provider. Existing Runs keep the guidance they started with; editing or clearing it does not erase their history.";

const ARCHIVED_INSTRUCTIONS_NOTE =
  "This project is archived, so its instructions are read-only until it is unarchived.";

const INSTRUCTIONS_SAVE_FAILED = "Couldn't save instructions. Try again.";

const INSTRUCTIONS_TOO_LONG = `Shorten the instructions to ${INSTRUCTIONS_MAX} Unicode code points or fewer.`;

/** The editor's draft and persistence. The stored text is the baseline and a
 *  local draft overlays it only once the owner edits: leaving the draft
 *  undefined means a background refetch can never overwrite what is being
 *  written, and it is cleared only after a save settles. Whitespace-only text
 *  is the stored form of "no instructions" (the API normalizes it to null);
 *  anything else is kept literally, never trimmed. On failure the mutation's
 *  error is exposed and the literal draft is kept so the owner can retry. */
function useInstructionsDraft(project: ProjectResponse) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const update = useUpdateProject();
  const persisted = project.instructions ?? "";
  const archived = project.archivedAt !== null;
  const value = archived ? persisted : (draft ?? persisted);
  const nextInstructions = value.trim() === "" ? null : value;
  const count = Array.from(value).length;
  const tooLong = count > INSTRUCTIONS_MAX;
  const pending = update.isPending;
  const unchanged = nextInstructions === project.instructions;
  const saveDisabled = archived || unchanged || tooLong || pending;

  const save = () => {
    if (saveDisabled) return;
    update.mutate(
      { id: project.id, instructions: nextInstructions },
      { onSuccess: () => setDraft(undefined) },
    );
  };

  return {
    value,
    count,
    tooLong,
    archived,
    pending,
    saveFailed: update.isError,
    saveDisabled,
    save,
    onChange: setDraft,
  };
}

function InstructionsForm({ project }: { project: ProjectResponse }) {
  const draft = useInstructionsDraft(project);
  const fieldId = useId();

  return (
    <Field data-invalid={draft.tooLong} data-disabled={draft.archived}>
      <FieldLabel htmlFor={fieldId}>Project instructions</FieldLabel>
      <Textarea
        id={fieldId}
        value={draft.value}
        onChange={(event) => draft.onChange(event.target.value)}
        placeholder="Add guidance for chats in this project."
        disabled={draft.archived || draft.pending}
        aria-invalid={draft.tooLong}
        aria-describedby={`${fieldId}-hint${
          draft.tooLong || draft.saveFailed ? ` ${fieldId}-error` : ""
        }`}
      />
      <FieldDescription id={`${fieldId}-hint`}>
        {draft.archived ? ARCHIVED_INSTRUCTIONS_NOTE : null}{" "}
        {INSTRUCTIONS_DISCLOSURE}{" "}
        <span aria-live="polite">
          {draft.count} / {INSTRUCTIONS_MAX} Unicode code points
        </span>
      </FieldDescription>
      {draft.tooLong || draft.saveFailed ? (
        <FieldError id={`${fieldId}-error`}>
          {draft.tooLong ? INSTRUCTIONS_TOO_LONG : INSTRUCTIONS_SAVE_FAILED}
        </FieldError>
      ) : null}
      <Button
        type="button"
        size="sm"
        onClick={draft.save}
        disabled={draft.saveDisabled}
      >
        {draft.pending ? <Spinner /> : null} Save instructions
      </Button>
    </Field>
  );
}

function ProjectInstructionsSection({ project }: { project: ProjectResponse }) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="space-y-3 p-4">
      <h2 id={headingId} className="text-sm font-semibold">
        Instructions
      </h2>
      <InstructionsForm project={project} />
    </section>
  );
}

/** The project page's side panel: the project's instructions editor and its
 *  repositories. From `lg` it takes the page grid's third column beside the
 *  composer and chats, out of flow so its height never stretches the
 *  composer's row. The editor is keyed by the project so a draft can never
 *  follow the page to another project. */
export function ProjectSidePanel({ project }: { project: ProjectResponse }) {
  return (
    <div className="min-w-0 lg:relative lg:col-start-3 lg:row-span-2 lg:row-start-1">
      <aside
        aria-label="Project settings"
        className="divide-y rounded-lg border lg:absolute lg:inset-x-0 lg:top-0"
      >
        <ProjectInstructionsSection key={project.id} project={project} />
        <ProjectRepositoriesSection projectId={project.id} />
      </aside>
    </div>
  );
}
