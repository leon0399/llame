"use client";

import { Alert, AlertTitle } from "@workspace/ui/components/alert";

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { repositoryFailureMessage } from "@/lib/services/repositories/failure";
import { useUnlinkProjectRepository } from "@/lib/services/project/mutations";
import type { ProjectRepositoryLink } from "@/lib/services/project/types";

/** A refusal in the server's words, or nothing. */
export function Refusal({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>{message}</AlertTitle>
    </Alert>
  );
}

/** Unlinks one repository: the link goes, the repository, its checkouts, and
 *  their directories stay. The surface that opened this shows the failure,
 *  since the confirmation dialog has no room for one. */
export function UnlinkRepositoryLinkDialog({
  projectId,
  link,
  open,
  onOpenChange,
  onFailure,
}: {
  projectId: string;
  link: ProjectRepositoryLink;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFailure: (message: string) => void;
}) {
  const unlink = useUnlinkProjectRepository();
  const confirm = () =>
    unlink.mutate(
      { projectId, repositoryId: link.repositoryId },
      {
        onSettled: () => onOpenChange(false),
        onError: (error) =>
          onFailure(
            repositoryFailureMessage(error, "Couldn't unlink the repository."),
          ),
      },
    );
  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Unlink repository?"
      description={`“${link.alias}” leaves this project. The repository, its checkouts, and their directories stay.`}
      confirmLabel="Unlink"
      onConfirm={confirm}
      isPending={unlink.isPending}
    />
  );
}
