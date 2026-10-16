"use client";

import { useId, useState, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { DialogSubmitFooter } from "@/components/dialog-submit-footer";
import {
  useCreateProject,
  useDeleteProject,
  useFileChat,
  useUpdateProject,
} from "@/lib/services/project/mutations";
import type { UpdateProjectPatch } from "@/lib/services/project/mutations";
import type { ProjectResponse } from "@/lib/services/project/types";

// Mirrors ../app-sidebar/chat-item-dialogs.tsx's Rename/Delete pattern —
// same Dialog+Input / AlertDialog shapes, no new visual language.
const NAME_MAX = 200;
// The API's own cap on an owner-authored description (UpdateProjectDto); the
// browser stops typing here rather than letting a save come back 400.
const DESCRIPTION_MAX = 1000;

function NameEntryInput({
  name,
  onNameChange,
  onSubmit,
  placeholder,
}: {
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
  placeholder?: string;
}) {
  return (
    <Input
      value={name}
      onChange={(e) => onNameChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSubmit();
        }
      }}
      maxLength={NAME_MAX}
      placeholder={placeholder}
      aria-label="Project name"
      // Deliberate: WAI-ARIA dialog pattern moves focus into the modal on
      // open; this is the dialog's primary field.
      // oxlint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
    />
  );
}

/** The Dialog frame `NewProjectDialog` and `RenameProjectDialog` both need —
 *  split out so each owns only its own field and submit logic. The body is a
 *  child rather than a prop set, so each form's field state lives BELOW
 *  `DialogContent`: the content unmounts while the dialog is closed, which
 *  re-seeds the field on every open without a mount-time reset. */
function NameEntryDialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Follow-up on the created project (e.g. file the requesting chat into it). */
  onCreated?: (project: ProjectResponse) => void;
}) {
  return (
    <NameEntryDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New project"
    >
      <NewProjectForm
        onClose={() => onOpenChange(false)}
        onCreated={onCreated}
      />
    </NameEntryDialog>
  );
}

/** The field and mutation, mounted together with the dialog's content — so a
 *  reopened dialog is a fresh mount whose field starts blank. */
function NewProjectForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (project: ProjectResponse) => void;
}) {
  const create = useCreateProject();
  const [name, setName] = useState("");

  const submit = () => {
    const next = name.trim();
    // isPending: the Create button disables itself, but Enter in the input
    // calls submit() directly — guard the double-fire here too.
    if (!next || create.isPending) return;
    create.mutate(next, {
      onSuccess: (project) => {
        onClose();
        onCreated?.(project);
      },
    });
  };

  return (
    <>
      <NameEntryInput
        name={name}
        onNameChange={setName}
        onSubmit={submit}
        placeholder="Project name"
      />
      <DialogSubmitFooter
        onCancel={onClose}
        onSubmit={submit}
        submitLabel="Create"
        submitDisabled={!name.trim() || create.isPending}
      />
    </>
  );
}

/**
 * "New project" invoked FROM a chat row's filing submenu: one shared dialog
 * instance per list (never one per row), and the requesting chat is filed
 * into the project the moment it's created — that's the only sensible intent
 * of that entry point. `chatId === null` ⇒ closed.
 */
export function CreateProjectForChatDialog({
  chatId,
  onClose,
}: {
  chatId: string | null;
  onClose: () => void;
}) {
  const fileChat = useFileChat();

  return (
    <NewProjectDialog
      open={chatId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onCreated={(project) => {
        if (chatId !== null) {
          fileChat.mutate({ chatId, projectId: project.id });
        }
      }}
    />
  );
}

// Only id/name are read below — a narrow shape (not ProjectResponse) so
// callers that only have a lean reference card (e.g. the rail's pinned
// project rows, which never load the full ProjectResponse) can pass one
// directly. Every existing ProjectResponse caller is a superset and still
// typechecks.
type ProjectRef = { id: string; name: string };

export function RenameProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <NameEntryDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rename project"
    >
      <RenameProjectForm
        project={project}
        onClose={() => onOpenChange(false)}
      />
    </NameEntryDialog>
  );
}

/** Seeded from the project's name at mount — i.e. each time the dialog opens. */
function RenameProjectForm({
  project,
  onClose,
}: {
  project: ProjectRef;
  onClose: () => void;
}) {
  const rename = useUpdateProject();
  const [name, setName] = useState(project.name);

  const submit = () => {
    if (rename.isPending) return; // Enter bypasses the disabled Save button
    const next = name.trim();
    if (!next || next === project.name) {
      onClose();
      return;
    }
    rename.mutate({ id: project.id, name: next }, { onSuccess: onClose });
  };

  return (
    <>
      <NameEntryInput name={name} onNameChange={setName} onSubmit={submit} />
      <DialogSubmitFooter
        onCancel={onClose}
        onSubmit={submit}
        submitLabel="Save"
        submitDisabled={!name.trim() || rename.isPending}
      />
    </>
  );
}

/** The Settings dialog's own shape: the same lean card Rename and Delete take,
 *  plus the description only an edit surface needs. */
type ProjectSettingsRef = ProjectRef & { description: string | null };

/** The project's two editable fields in one dialog — the name the Rename
 *  dialog also edits, and the description. Rename stays as the one-field
 *  shortcut to the name; this is where both live together. */
export function SettingsProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectSettingsRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <NameEntryDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Project settings"
    >
      <SettingsProjectForm
        project={project}
        onClose={() => onOpenChange(false)}
      />
    </NameEntryDialog>
  );
}

/** The Settings dialog's name field: the same control Rename uses, plus the
 *  visible label a two-field form needs. Enter saves. */
function SettingsNameField({
  name,
  onNameChange,
  onSubmit,
}: {
  name: string;
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
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        maxLength={NAME_MAX}
        placeholder="Project name"
        // Deliberate: WAI-ARIA dialog pattern moves focus into the modal on
        // open; this is the dialog's primary field.
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
    </div>
  );
}

/** The description field: multi-line, since a project description is prose.
 *  Enter inserts a newline here rather than saving. */
function SettingsDescriptionField({
  description,
  onDescriptionChange,
}: {
  description: string;
  onDescriptionChange: (description: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Description</Label>
      <Textarea
        id={id}
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        maxLength={DESCRIPTION_MAX}
        rows={4}
        placeholder="What this project is for"
      />
    </div>
  );
}

/** The patch a save should send, or null when there is nothing to save: a
 *  blank name (Save is disabled for it, but Enter calls submit directly) or an
 *  untouched pair both just close the dialog, exactly as Rename's own field
 *  does. Only fields that actually moved are sent, so a `project.upserted`
 *  that landed while the dialog was open (a rename from a second tab) is not
 *  reverted by a save made to edit prose — the client keeps the API's
 *  "omitted means unchanged" contract. A blank description becomes null, the
 *  stored form of "no description". */
function projectSettingsPatch(
  project: ProjectSettingsRef,
  name: string,
  description: string,
): UpdateProjectPatch | null {
  const nextName = name.trim();
  if (!nextName) return null;
  const nextDescription = description.trim();
  const patch: UpdateProjectPatch = {};
  if (nextName !== project.name) patch.name = nextName;
  if (nextDescription !== (project.description ?? "")) {
    patch.description = nextDescription || null;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

/** Seeded from the project at mount — i.e. each time the dialog opens — and
 *  saved as one PATCH of the fields that moved (see projectSettingsPatch). */
function SettingsProjectForm({
  project,
  onClose,
}: {
  project: ProjectSettingsRef;
  onClose: () => void;
}) {
  const update = useUpdateProject();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");

  const submit = () => {
    if (update.isPending) return; // Save disables itself, Enter does not
    const patch = projectSettingsPatch(project, name, description);
    if (patch === null) {
      onClose();
      return;
    }
    update.mutate({ id: project.id, ...patch }, { onSuccess: onClose });
  };

  return (
    <>
      <SettingsNameField name={name} onNameChange={setName} onSubmit={submit} />
      <SettingsDescriptionField
        description={description}
        onDescriptionChange={setDescription}
      />
      <DialogSubmitFooter
        onCancel={onClose}
        onSubmit={submit}
        submitLabel="Save"
        submitDisabled={!name.trim() || update.isPending}
      />
    </>
  );
}

export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const del = useDeleteProject();

  const confirm = () => {
    del.mutate(project.id, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete project?"
      description={
        <>
          “{project.name}” will be deleted. Its chats will be unfiled, not
          deleted — they’ll reappear in your regular chat list.
        </>
      }
      onConfirm={confirm}
      isPending={del.isPending}
    />
  );
}
