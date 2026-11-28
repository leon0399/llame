"use client";

import { useId, useState } from "react";
import { PencilIcon, PlusIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { FieldError } from "@workspace/ui/components/field";
import { Spinner } from "@workspace/ui/components/spinner";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";

import {
  ModEnterKbd,
  submitOnModEnter,
  useModEnterAria,
} from "@/components/mod-enter-submit";
import { useUpdateProject } from "@/lib/services/project/mutations";
import type { ProjectResponse } from "@/lib/services/project/types";

/** The API's cap, counted in Unicode code points, as the server counts them. */
const INSTRUCTIONS_MAX = 16_000;

/** The count appears only once the text nears the cap. */
const COUNT_SHOWN_FROM = 14_000;

const EDITOR_DESCRIPTION =
  "Every chat in this project follows these from its next reply, and they are sent to your model provider. A reply already in progress keeps the instructions it started with.";

const ARCHIVED_DESCRIPTION =
  "This project is archived, so its instructions are read-only until it is unarchived.";

const EMPTY_HINT =
  "Tell the assistant how to work here: conventions, tone, what to avoid.";

/** What the owner typed, and what saving it would store: whitespace-only text
 *  clears the instructions, anything else is kept literally. */
function savedForm(text: string): string | null {
  return text.trim() === "" ? null : text;
}

/**
 * The stored instructions as one card, clamped to six lines; selecting it
 * opens the editor, which shows them in full. The pencil marks the card as
 * editable: shown on hover and keyboard focus, and always on touch, where
 * there is no hover. An archived project's card opens read-only and has none.
 */
function InstructionsPreview({
  text,
  archived,
  onOpen,
}: {
  text: string;
  archived: boolean;
  onOpen: () => void;
}) {
  const textId = useId();

  return (
    <button
      type="button"
      onClick={onOpen}
      // A short name; the clamped text is its description.
      aria-label={archived ? "View instructions" : "Edit instructions"}
      aria-describedby={textId}
      className="group/preview flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span
        id={textId}
        className="line-clamp-6 min-w-0 flex-1 break-words whitespace-pre-wrap"
      >
        {text}
      </span>
      {archived ? null : (
        <PencilIcon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-opacity md:opacity-0 md:group-hover/preview:opacity-100 md:group-focus-visible/preview:opacity-100"
        />
      )}
    </button>
  );
}

/** No instructions yet: one dashed call to action, or a plain note when the
 *  project is archived and cannot take any. */
function InstructionsEmpty({
  archived,
  onAdd,
}: {
  archived: boolean;
  onAdd: () => void;
}) {
  if (archived) {
    return <p className="text-sm text-muted-foreground">No instructions.</p>;
  }

  return (
    <button
      type="button"
      onClick={onAdd}
      className="flex w-full flex-col items-start gap-1 rounded-lg border border-dashed px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <PlusIcon aria-hidden="true" className="size-4" />
        Add instructions
      </span>
      <span className="text-xs text-muted-foreground">{EMPTY_HINT}</span>
    </button>
  );
}

/** The count, on the footer's left, only once the text nears the cap. */
function EditorCount({ count }: { count: number }) {
  if (count < COUNT_SHOWN_FROM) return null;

  return (
    <span
      aria-live="polite"
      className={cn(
        "self-center text-xs text-muted-foreground tabular-nums sm:mr-auto",
        count > INSTRUCTIONS_MAX && "text-destructive",
      )}
    >
      {count.toLocaleString("en-US")} /{" "}
      {INSTRUCTIONS_MAX.toLocaleString("en-US")} characters
    </span>
  );
}

export interface InstructionsEditorProps {
  /** The stored instructions, shown until the owner edits them. */
  stored: string | null;
  /** An archived project shows its instructions read-only. */
  archived: boolean;
  pending: boolean;
  /** Set after a failed save; the draft stays so the owner can retry. */
  failed: boolean;
  onSave: (instructions: string | null) => void;
  onClose: () => void;
}

/**
 * The editor's draft: what saving would store, and whether it can. The draft
 * stays undefined until the owner edits, so the editor follows the stored
 * text through a background refetch and an untouched editor can never save
 * stale text over newer instructions. An archived project shows only what is
 * stored, so a hidden draft is neither shown nor validated.
 */
function useEditorDraft(props: InstructionsEditorProps) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const stored = props.stored ?? "";
  const value = props.archived ? stored : (draft ?? stored);
  const count = Array.from(value).length;
  const tooLong = count > INSTRUCTIONS_MAX;
  const unchanged = savedForm(value) === props.stored;
  const canSave = !props.archived && !props.pending && !tooLong && !unchanged;

  const save = () => {
    if (canSave) props.onSave(savedForm(value));
  };

  return {
    value,
    setDraft,
    count,
    tooLong,
    canSave,
    save,
    onKeyDown: submitOnModEnter(save),
  };
}

/** Why the draft cannot be saved, or why it was not. `id` names the message
 *  for the textarea's `aria-describedby`. */
function EditorErrors({
  id,
  tooLong,
  failed,
}: {
  id: string;
  tooLong: boolean;
  failed: boolean;
}) {
  if (!tooLong && !failed) return null;

  return (
    <FieldError id={id}>
      {tooLong
        ? `Shorten the instructions to ${INSTRUCTIONS_MAX.toLocaleString("en-US")} characters or fewer.`
        : "Couldn't save the instructions. Your text is still here; try again."}
    </FieldError>
  );
}

/** Save, naming its Ctrl/⌘+Enter shortcut inside the button. */
function SaveButton({
  pending,
  disabled,
  onSave,
}: {
  pending: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  return (
    <Button
      onClick={onSave}
      disabled={disabled}
      aria-keyshortcuts={useModEnterAria()}
    >
      {pending ? <Spinner data-icon="inline-start" /> : null}
      Save
      <ModEnterKbd />
    </Button>
  );
}

/** Cancel and Save, with the save shortcut on Save, or only Close for an
 *  archived project. */
function EditorActions({
  archived,
  pending,
  canSave,
  count,
  onSave,
  onClose,
}: {
  archived: boolean;
  pending: boolean;
  canSave: boolean;
  count: number;
  onSave: () => void;
  onClose: () => void;
}) {
  if (archived) {
    return (
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
      </DialogFooter>
    );
  }

  return (
    <DialogFooter>
      <EditorCount count={count} />
      <Button variant="outline" onClick={onClose} disabled={pending}>
        Cancel
      </Button>
      <SaveButton pending={pending} disabled={!canSave} onSave={onSave} />
    </DialogFooter>
  );
}

/**
 * The instructions editor, opened from the section. It holds its own draft,
 * so closing it without saving discards the edit, and a failed save keeps the
 * draft and says so. It renders inside a `Dialog`, which shows it only while
 * open, and is bounded to the viewport and scrollable so its footer stays
 * reachable on a short screen.
 */
export function InstructionsEditor(props: InstructionsEditorProps) {
  const { archived, pending } = props;
  const editor = useEditorDraft(props);
  const errorId = useId();

  return (
    <DialogContent className="max-h-11/12 overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Project instructions</DialogTitle>
        <DialogDescription>
          {archived ? ARCHIVED_DESCRIPTION : EDITOR_DESCRIPTION}
        </DialogDescription>
      </DialogHeader>
      <Textarea
        aria-label="Project instructions"
        aria-invalid={editor.tooLong}
        aria-describedby={editor.tooLong || props.failed ? errorId : undefined}
        value={editor.value}
        onChange={(event) => editor.setDraft(event.target.value)}
        onKeyDown={editor.onKeyDown}
        readOnly={archived}
        disabled={pending}
        placeholder={EMPTY_HINT}
        // A centered dialog grows both ways, so a dragged resize handle would
        // trail the cursor at half speed; the field grows with its text.
        className="max-h-96 min-h-48 resize-none"
      />
      <EditorErrors
        id={errorId}
        tooLong={editor.tooLong}
        failed={props.failed}
      />
      <EditorActions
        archived={archived}
        pending={pending}
        canSave={editor.canSave}
        count={editor.count}
        onSave={editor.save}
        onClose={props.onClose}
      />
    </DialogContent>
  );
}

/** The editor's open state and the save, wired to the project mutation. A
 *  successful save closes the editor; a failed one leaves it open. While a
 *  save is in flight the editor stays open, so a second save cannot overlap
 *  the first. */
function useInstructionsEditor(project: ProjectResponse) {
  const [open, setOpen] = useState(false);
  // Each opening is a new editor session with a fresh draft; the editor
  // stays mounted across a close so the dialog's exit animation plays.
  const [session, setSession] = useState(0);
  const update = useUpdateProject();

  const setEditorOpen = (next: boolean) => {
    if (!next && update.isPending) return;

    if (next) {
      update.reset();
      setSession((current) => current + 1);
    }

    setOpen(next);
  };

  return {
    open,
    session,
    setOpen: setEditorOpen,
    pending: update.isPending,
    failed: update.isError,
    save: (instructions: string | null) =>
      update.mutate(
        { id: project.id, instructions },
        { onSuccess: () => setOpen(false) },
      ),
  };
}

/** The stored text as a preview, or the empty state when there is none. */
function InstructionsBody({
  stored,
  archived,
  onOpen,
}: {
  stored: string | null;
  archived: boolean;
  onOpen: () => void;
}) {
  return stored === null ? (
    <InstructionsEmpty archived={archived} onAdd={onOpen} />
  ) : (
    <InstructionsPreview text={stored} archived={archived} onOpen={onOpen} />
  );
}

/**
 * The project side panel's Instructions section: the stored instructions as a
 * short preview, or a call to add some, and an editor dialog for writing them.
 */
export function ProjectInstructionsSection({
  project,
}: {
  project: ProjectResponse;
}) {
  const headingId = useId();
  const editor = useInstructionsEditor(project);
  const archived = project.archivedAt !== null;
  const stored = project.instructions;
  const openEditor = () => editor.setOpen(true);

  return (
    <section aria-labelledby={headingId} className="space-y-2 p-4">
      <h2 id={headingId} className="text-sm font-semibold">
        Instructions
      </h2>
      <InstructionsBody
        stored={stored}
        archived={archived}
        onOpen={openEditor}
      />
      <Dialog open={editor.open} onOpenChange={editor.setOpen}>
        <InstructionsEditor
          key={editor.session}
          stored={stored}
          archived={archived}
          pending={editor.pending}
          failed={editor.failed}
          onSave={editor.save}
          onClose={() => editor.setOpen(false)}
        />
      </Dialog>
    </section>
  );
}
