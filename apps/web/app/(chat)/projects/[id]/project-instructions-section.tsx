"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { PencilIcon, PlusIcon } from "lucide-react";

import { Alert, AlertDescription } from "@workspace/ui/components/alert";
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
import { Kbd } from "@workspace/ui/components/kbd";
import { usePrimaryModifierKey } from "@workspace/ui/hooks/use-modifier-key";
import { Spinner } from "@workspace/ui/components/spinner";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";

import { useUpdateProject } from "@/lib/services/project/mutations";
import type { ProjectResponse } from "@/lib/services/project/types";

/** The API's cap, counted in Unicode code points, as the server counts them. */
const INSTRUCTIONS_MAX = 16_000;

/** The count appears only once the text nears the cap. */
const COUNT_SHOWN_FROM = 14_000;

const EDITOR_DESCRIPTION =
  "The assistant follows these in new chats in this project, and they are sent to your model provider. Chats already running keep the instructions they started with.";

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
  /** The stored instructions, the editor's starting text. */
  stored: string | null;
  /** An archived project shows its instructions read-only. */
  archived: boolean;
  pending: boolean;
  /** Set after a failed save; the draft stays so the owner can retry. */
  failed: boolean;
  onSave: (instructions: string | null) => void;
  onClose: () => void;
}

/** The editor's draft: what saving would store, and whether it can. */
function useEditorDraft(props: InstructionsEditorProps) {
  const [draft, setDraft] = useState(props.stored ?? "");
  const count = Array.from(draft).length;
  const tooLong = count > INSTRUCTIONS_MAX;
  const unchanged = savedForm(draft) === props.stored;
  const canSave = !props.archived && !props.pending && !tooLong && !unchanged;

  const save = () => {
    if (canSave) props.onSave(savedForm(draft));
  };

  return {
    draft,
    setDraft,
    count,
    tooLong,
    canSave,
    save,
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        save();
      }
    },
  };
}

/** Why the draft cannot be saved, or why it was not. */
function EditorAlerts({
  tooLong,
  failed,
}: {
  tooLong: boolean;
  failed: boolean;
}) {
  return (
    <>
      {tooLong ? (
        <Alert variant="destructive">
          <AlertDescription>
            Shorten the instructions to{" "}
            {INSTRUCTIONS_MAX.toLocaleString("en-US")} characters or fewer.
          </AlertDescription>
        </Alert>
      ) : null}
      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>
            Couldn't save the instructions. Your text is still here; try again.
          </AlertDescription>
        </Alert>
      ) : null}
    </>
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
  const modifierKey = usePrimaryModifierKey();

  return (
    <Button
      onClick={onSave}
      disabled={disabled}
      aria-keyshortcuts={`${modifierKey === "⌘" ? "Meta" : "Control"}+Enter`}
    >
      {pending ? <Spinner data-icon="inline-start" /> : null}
      Save
      {/* Announced through `aria-keyshortcuts`, not the button's name. */}
      <Kbd aria-hidden="true">
        {modifierKey}
        <span>↵</span>
      </Kbd>
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
 * draft and says so.
 */
export function InstructionsEditor(props: InstructionsEditorProps) {
  const { archived, pending } = props;
  const editor = useEditorDraft(props);

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Project instructions</DialogTitle>
        <DialogDescription>
          {archived ? ARCHIVED_DESCRIPTION : EDITOR_DESCRIPTION}
        </DialogDescription>
      </DialogHeader>
      <Textarea
        aria-label="Project instructions"
        aria-invalid={editor.tooLong}
        // An editor open when the project is archived shows what is stored,
        // not a draft the project can no longer take.
        value={archived ? (props.stored ?? "") : editor.draft}
        onChange={(event) => editor.setDraft(event.target.value)}
        onKeyDown={editor.onKeyDown}
        readOnly={archived}
        disabled={pending}
        placeholder={EMPTY_HINT}
        className="max-h-96 min-h-48"
      />
      <EditorAlerts tooLong={editor.tooLong} failed={props.failed} />
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
 *  successful save closes the editor; a failed one leaves it open. */
function useInstructionsEditor(project: ProjectResponse) {
  const [open, setOpen] = useState(false);
  const update = useUpdateProject();

  const setEditorOpen = (next: boolean) => {
    // Each opening starts from the stored text, with no stale failure.
    if (next) update.reset();
    setOpen(next);
  };

  return {
    open,
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
        {editor.open ? (
          <InstructionsEditor
            stored={stored}
            archived={archived}
            pending={editor.pending}
            failed={editor.failed}
            onSave={editor.save}
            onClose={() => editor.setOpen(false)}
          />
        ) : null}
      </Dialog>
    </section>
  );
}
