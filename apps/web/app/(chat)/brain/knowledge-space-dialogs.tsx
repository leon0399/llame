"use client";

import { useId, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";

import { DialogFrame } from "@/components/dialog-frame";
import { DialogSubmitFooter } from "@/components/dialog-submit-footer";
import type { KnowledgeSpaceResponse } from "@/lib/api/generated/models";
import {
  useCreateKnowledgeSpace,
  useRenameKnowledgeSpace,
  useSetKnowledgeSpaceArchive,
} from "@/lib/services/knowledge-spaces/mutations";
import { knowledgeSpaceNameError } from "@/lib/services/knowledge-spaces/name";

/** Which management dialog is open. Closed is the resting state. */
export type KnowledgeSpaceDialogState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "rename"; space: KnowledgeSpaceResponse }
  | { kind: "archive"; space: KnowledgeSpaceResponse };

/**
 * Create, rename, and archive dialogs for one Knowledge Space list.
 * The name form remounts each time a dialog opens.
 */
export function KnowledgeSpaceDialogs({
  dialog,
  onClose,
}: {
  dialog: KnowledgeSpaceDialogState;
  onClose: () => void;
}) {
  const renaming = dialog.kind === "rename";

  return (
    <>
      <KnowledgeSpaceNameDialog
        open={dialog.kind === "create" || renaming}
        title={renaming ? "Rename Knowledge Space" : "New Knowledge Space"}
        submitLabel={renaming ? "Save" : "Create"}
        initialName={renaming ? dialog.space.name : ""}
        spaceId={renaming ? dialog.space.id : undefined}
        onClose={onClose}
      />
      <ArchiveKnowledgeSpaceDialog
        space={dialog.kind === "archive" ? dialog.space : undefined}
        onClose={onClose}
      />
    </>
  );
}

function KnowledgeSpaceNameDialog({
  open,
  title,
  submitLabel,
  initialName,
  spaceId,
  onClose,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  initialName: string;
  spaceId: string | undefined;
  onClose: () => void;
}) {
  return (
    <DialogFrame
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
    >
      <KnowledgeSpaceNameForm
        key={spaceId ?? "create"}
        initialName={initialName}
        submitLabel={submitLabel}
        spaceId={spaceId}
        onClose={onClose}
      />
    </DialogFrame>
  );
}

function useKnowledgeSpaceName(initialName: string) {
  const [name, setName] = useState(initialName);
  const [submitted, setSubmitted] = useState(false);

  return {
    name,
    setName,
    error: submitted ? knowledgeSpaceNameError(name) : null,
    invalid: knowledgeSpaceNameError(name) !== null,
    markSubmitted: () => setSubmitted(true),
  };
}

function KnowledgeSpaceNameForm({
  initialName,
  submitLabel,
  spaceId,
  onClose,
}: {
  initialName: string;
  submitLabel: string;
  spaceId: string | undefined;
  onClose: () => void;
}) {
  const draft = useKnowledgeSpaceName(initialName);
  const pending = useSaveKnowledgeSpaceName(draft, spaceId, onClose);

  return (
    <>
      <KnowledgeSpaceNameField
        name={draft.name}
        error={draft.error}
        onNameChange={draft.setName}
        onSubmit={pending.save}
      />
      <DialogSubmitFooter
        onCancel={onClose}
        onSubmit={pending.save}
        submitLabel={submitLabel}
        submitDisabled={pending.pending}
      />
    </>
  );
}

function useSaveKnowledgeSpaceName(
  draft: ReturnType<typeof useKnowledgeSpaceName>,
  spaceId: string | undefined,
  onClose: () => void,
) {
  const create = useCreateKnowledgeSpace();
  const rename = useRenameKnowledgeSpace();
  const pending = create.isPending || rename.isPending;

  const save = () => {
    draft.markSubmitted();

    if (draft.invalid || pending) return;

    const nextName = draft.name.trim();

    if (spaceId === undefined) {
      create.mutate(nextName, { onSuccess: onClose });

      return;
    }

    rename.mutate({ id: spaceId, name: nextName }, { onSuccess: onClose });
  };

  return { pending, save };
}

function KnowledgeSpaceNameField({
  name,
  error,
  onNameChange,
  onSubmit,
}: {
  name: string;
  error: string | null;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
}) {
  const id = useId();

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Name</Label>
      <Input
        id={id}
        value={name}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : `${id}-error`}
        onChange={(event) => onNameChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder="Space name"
        // Deliberate: the dialog moves focus to its primary field on open.
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      {error === null ? null : (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function ArchiveKnowledgeSpaceDialog({
  space,
  onClose,
}: {
  space: KnowledgeSpaceResponse | undefined;
  onClose: () => void;
}) {
  const archive = useSetKnowledgeSpaceArchive();

  return (
    <AlertDialog
      open={space !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <ArchiveKnowledgeSpaceCopy name={space?.name} />
        <ArchiveKnowledgeSpaceConfirm
          pending={archive.isPending}
          onConfirm={() => confirmArchive(space, archive.mutate, onClose)}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ArchiveKnowledgeSpaceCopy({ name }: { name: string | undefined }) {
  return (
    <AlertDialogHeader>
      <AlertDialogTitle>Archive “{name ?? "this Space"}”?</AlertDialogTitle>
      <AlertDialogDescription>
        The Space leaves search and the working list. Its files stay on disk.
        You can restore it from the archived view.
      </AlertDialogDescription>
    </AlertDialogHeader>
  );
}

function confirmArchive(
  space: KnowledgeSpaceResponse | undefined,
  mutate: ReturnType<typeof useSetKnowledgeSpaceArchive>["mutate"],
  onClose: () => void,
) {
  if (space === undefined) return;

  mutate({ id: space.id, archived: true }, { onSuccess: onClose });
}

function ArchiveKnowledgeSpaceConfirm({
  pending,
  onConfirm,
}: {
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onClick={(event) => {
          event.preventDefault();
          onConfirm();
        }}
        disabled={pending}
      >
        Archive
      </AlertDialogAction>
    </AlertDialogFooter>
  );
}
