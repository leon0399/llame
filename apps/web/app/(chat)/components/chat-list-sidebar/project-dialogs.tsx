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

// Mirrors ../app-sidebar/chat-item-dialogs.tsx's Dialog / AlertDialog shapes,
// no new visual language.
const NAME_MAX = 200;
// The API's own cap on an owner-authored description (Create/UpdateProjectDto);
// the browser stops typing here rather than letting a save come back 400.
const DESCRIPTION_MAX = 1000;

// Only id/name are read by Delete — a narrow shape (not ProjectResponse) so
// callers that only have a lean reference card (e.g. the rail's pinned
// project rows) can pass one directly.
type ProjectRef = { id: string; name: string };

/** What the details dialog edits: the lean card plus the description. */
type ProjectDetailsRef = ProjectRef & { description: string | null };

/** The Dialog frame both details dialogs share. The body is a child rather
 *  than a prop set, so its field state lives BELOW `DialogContent`: the
 *  content unmounts while the dialog is closed, which re-seeds the fields on
 *  every open without a mount-time reset. */
function ProjectDetailsFrame({
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

/** The name field: single line, and Enter saves. */
function ProjectNameField({
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
function ProjectDescriptionField({
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

/** Both fields and the footer, seeded from `initial` at mount. Submitting
 *  with a blank name does nothing (Save is disabled for it, but Enter calls
 *  submit directly), as does submitting while a save is in flight. */
function ProjectDetailsFields({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onClose,
}: {
  initial: { name: string; description: string };
  submitLabel: string;
  pending: boolean;
  onSubmit: (name: string, description: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const submit = () => {
    if (!name.trim() || pending) return;
    onSubmit(name, description);
  };

  return (
    <>
      <ProjectNameField name={name} onNameChange={setName} onSubmit={submit} />
      <ProjectDescriptionField
        description={description}
        onDescriptionChange={setDescription}
      />
      <DialogSubmitFooter
        onCancel={onClose}
        onSubmit={submit}
        submitLabel={submitLabel}
        submitDisabled={!name.trim() || pending}
      />
    </>
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
    <ProjectDetailsFrame
      open={open}
      onOpenChange={onOpenChange}
      title="New project"
    >
      <NewProjectForm
        onClose={() => onOpenChange(false)}
        onCreated={onCreated}
      />
    </ProjectDetailsFrame>
  );
}

/** Mounted with the dialog's content, so a reopened dialog starts blank. A
 *  blank description is sent as null, the stored form of "no description". */
function NewProjectForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (project: ProjectResponse) => void;
}) {
  const create = useCreateProject();
  return (
    <ProjectDetailsFields
      initial={{ name: "", description: "" }}
      submitLabel="Create"
      pending={create.isPending}
      onClose={onClose}
      onSubmit={(name, description) =>
        create.mutate(
          { name: name.trim(), description: description.trim() || null },
          {
            onSuccess: (project) => {
              onClose();
              onCreated?.(project);
            },
          },
        )
      }
    />
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

/** The patch a save should send, or null when there is nothing to save: an
 *  untouched pair just closes the dialog. Only fields that actually moved
 *  are sent, so a `project.upserted` that landed while the dialog was open (a
 *  rename from a second tab) is not reverted by a save made to edit prose —
 *  the client keeps the API's "omitted means unchanged" contract. A blank
 *  description becomes null, the stored form of "no description".
 *
 *  The description comparison trims the stored value the way it trims the
 *  input: the API keeps what it is given, so a description written around its
 *  own whitespace (a direct API write, say) must not read as an edit its owner
 *  never made. */
function projectDetailsPatch(
  project: ProjectDetailsRef,
  name: string,
  description: string,
): UpdateProjectPatch | null {
  const nextName = name.trim();
  const nextDescription = description.trim();
  const patch: UpdateProjectPatch = {};
  if (nextName !== project.name) patch.name = nextName;
  if (nextDescription !== (project.description ?? "").trim()) {
    patch.description = nextDescription || null;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

/** What Edit details shows before the form: the read of a lean card's
 *  description is still running, or it failed. */
function ProjectDetailsPending({ failed }: { failed: boolean }) {
  return failed ? (
    <p role="alert" className="text-sm text-destructive">
      Couldn&apos;t load this project&apos;s details. Close and try again.
    </p>
  ) : (
    <output className="text-sm text-muted-foreground">Loading details…</output>
  );
}

/** The project's details — name and description — edited together; the one
 *  edit surface every project menu opens. A lean card (no `description`)
 *  opens it at once, and the form appears once the full project is read. */
export function EditProjectDialog({
  project,
  readFailed = false,
  open,
  onOpenChange,
}: {
  project: ProjectRef & { description?: string | null };
  /** The read of a lean card's full project failed. */
  readFailed?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { description } = project;
  return (
    <ProjectDetailsFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Edit details"
    >
      {description === undefined ? (
        <ProjectDetailsPending failed={readFailed} />
      ) : (
        <EditProjectForm
          project={{ ...project, description }}
          onClose={() => onOpenChange(false)}
        />
      )}
    </ProjectDetailsFrame>
  );
}

/** Seeded from the project at mount — i.e. each time the dialog opens — and
 *  saved as one PATCH of the fields that moved (see projectDetailsPatch). */
function EditProjectForm({
  project,
  onClose,
}: {
  project: ProjectDetailsRef;
  onClose: () => void;
}) {
  const update = useUpdateProject();
  return (
    <ProjectDetailsFields
      initial={{ name: project.name, description: project.description ?? "" }}
      submitLabel="Save"
      pending={update.isPending}
      onClose={onClose}
      onSubmit={(name, description) => {
        const patch = projectDetailsPatch(project, name, description);
        if (patch === null) return onClose();
        update.mutate({ id: project.id, ...patch }, { onSuccess: onClose });
      }}
    />
  );
}

export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: {
  project: ProjectRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Follow-up once the project is gone (e.g. leave its page). */
  onDeleted?: () => void;
}) {
  const del = useDeleteProject();

  const confirm = () => {
    del.mutate(project.id, {
      onSuccess: () => {
        onOpenChange(false);
        onDeleted?.();
      },
    });
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
