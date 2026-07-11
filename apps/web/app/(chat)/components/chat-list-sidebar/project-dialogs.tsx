"use client";

import { useEffect, useState } from "react";

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
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";

import {
  useCreateProject,
  useDeleteProject,
  useUpdateProject,
} from "@/lib/services/project/mutations";
import type { ProjectResponse } from "@/lib/services/project/types";

// Mirrors ../app-sidebar/chat-item-dialogs.tsx's Rename/Delete pattern —
// same Dialog+Input / AlertDialog shapes, no new visual language.
const NAME_MAX = 200;

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
    create.mutate(next, { onSuccess: () => onOpenChange(false) });
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
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete project?</AlertDialogTitle>
          <AlertDialogDescription>
            “{project.name}” will be deleted. Its chats will be unfiled, not
            deleted — they’ll reappear in your regular chat list.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
