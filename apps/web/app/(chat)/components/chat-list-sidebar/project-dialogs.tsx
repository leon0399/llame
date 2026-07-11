"use client";

import { useEffect, useState } from "react";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import {
  useCreateProject,
  useDeleteProject,
  useFileChat,
  useUpdateProject,
} from "@/lib/services/project/mutations";
import type { ProjectResponse } from "@/lib/services/project/types";

// Mirrors ../app-sidebar/chat-item-dialogs.tsx's Rename/Delete pattern —
// same Dialog+Input / AlertDialog shapes, no new visual language.
const NAME_MAX = 200;

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
  const create = useCreateProject();
  const [name, setName] = useState("");

  // Start from a blank field every time the dialog opens.
  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const submit = () => {
    const next = name.trim();
    if (!next) return;
    create.mutate(next, {
      onSuccess: (project) => {
        onOpenChange(false);
        onCreated?.(project);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={NAME_MAX}
          placeholder="Project name"
          aria-label="Project name"
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || create.isPending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

export function RenameProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rename = useUpdateProject();
  const [name, setName] = useState(project.name);

  // Reset the field to the current name each time the dialog opens.
  useEffect(() => {
    if (open) setName(project.name);
  }, [open, project.name]);

  const submit = () => {
    const next = name.trim();
    if (!next || next === project.name) {
      onOpenChange(false);
      return;
    }
    rename.mutate(
      { id: project.id, name: next },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={NAME_MAX}
          aria-label="Project name"
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || rename.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectResponse;
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
