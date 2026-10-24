"use client";

import { useState } from "react";

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { repositoryFailureMessage } from "@/lib/services/repositories/failure";
import { useRepositoriesQuery } from "@/lib/services/repositories/queries";
import type { RepositoryResponse } from "@/lib/services/repositories/queries";
import {
  useLinkProjectRepository,
  useUnlinkProjectRepository,
  useUpdateProjectRepositoryLink,
  type LinkProjectRepositoryInput,
  type UpdateProjectRepositoryLinkInput,
} from "@/lib/services/project/mutations";
import type {
  IsolationPolicy,
  ProjectRepositoryLink,
} from "@/lib/services/project/types";

import {
  AliasField,
  DialogFormFooter,
  IsolationPicker,
  PrimaryField,
  RepositoryDialogFrame,
  RepositoryField,
} from "./project-repository-dialog-parts";

/** The patch a link edit sends; every field is optional because an untouched
 *  one is omitted rather than written back. */
type LinkPatch = Partial<
  Pick<UpdateProjectRepositoryLinkInput, "alias" | "isPrimary" | "isolation">
>;

/**
 * Links one catalog repository. The alias starts blank, where blank means the
 * route's own default: the repository's display name, stored on the link so a
 * later rename of the catalog entry leaves the project's label alone.
 */
export function LinkRepositoryDialog({
  projectId,
  linkedRepositoryIds,
  open,
  onOpenChange,
}: {
  projectId: string;
  linkedRepositoryIds: ReadonlySet<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repositories = useRepositoriesQuery(open);
  return (
    <RepositoryDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Link repository"
    >
      <LinkRepositoryForm
        projectId={projectId}
        repositories={(repositories.data ?? []).filter(
          (repository) => !linkedRepositoryIds.has(repository.id),
        )}
        onClose={() => onOpenChange(false)}
      />
    </RepositoryDialogFrame>
  );
}

/** The link form's state, its submit, and the write it makes; the form below
 *  only lays out its fields. */
function useLinkRepositoryForm(projectId: string, onClose: () => void) {
  const link = useLinkProjectRepository();
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [isolation, setIsolation] = useState<IsolationPolicy>("inherit");
  const [failure, setFailure] = useState<string | null>(null);

  const submit = () => {
    if (repositoryId === null || link.isPending) return;
    setFailure(null);
    const variables: LinkProjectRepositoryInput = {
      projectId,
      repositoryId,
      isPrimary,
      isolation,
    };
    // Blank keeps the route's default; an empty alias is not a name.
    if (alias.trim() !== "") variables.alias = alias.trim();
    link.mutate(variables, {
      onSuccess: onClose,
      onError: (error) =>
        setFailure(
          repositoryFailureMessage(error, "Couldn't link the repository."),
        ),
    });
  };

  return {
    repositoryId,
    setRepositoryId,
    alias,
    setAlias,
    isPrimary,
    setIsPrimary,
    isolation,
    setIsolation,
    failure,
    submit,
    pending: link.isPending,
  };
}

function LinkRepositoryForm({
  projectId,
  repositories,
  onClose,
}: {
  projectId: string;
  repositories: ReadonlyArray<RepositoryResponse>;
  onClose: () => void;
}) {
  const form = useLinkRepositoryForm(projectId, onClose);
  return (
    <>
      <RepositoryField
        repositories={repositories}
        selectedId={form.repositoryId}
        onSelect={form.setRepositoryId}
        emptyNote="Every repository in the catalog is already linked. Register another checkout to add one."
      />
      <AliasField
        alias={form.alias}
        onAliasChange={form.setAlias}
        placeholder="The repository's display name"
      />
      <PrimaryField
        isPrimary={form.isPrimary}
        onIsPrimaryChange={form.setIsPrimary}
      />
      <IsolationPicker value={form.isolation} onChange={form.setIsolation} />
      <DialogFormFooter
        failure={form.failure}
        onCancel={onClose}
        onSubmit={form.submit}
        submitLabel="Link"
        submitDisabled={form.repositoryId === null || form.pending}
      />
    </>
  );
}

/** The fields an edit changed, or null when nothing did — an untouched form
 *  just closes rather than writing back the values it read. */
function linkPatch(
  link: ProjectRepositoryLink,
  alias: string,
  isPrimary: boolean,
  isolation: IsolationPolicy,
) {
  const patch: LinkPatch = {};
  if (alias.trim() !== link.alias) patch.alias = alias.trim();
  if (isPrimary !== link.isPrimary) patch.isPrimary = isPrimary;
  if (isolation !== link.isolation) patch.isolation = isolation;
  return Object.keys(patch).length === 0 ? null : patch;
}

/** Changes one link's alias, primary flag, and isolation policy together. */
export function EditRepositoryLinkDialog({
  projectId,
  link,
  open,
  onOpenChange,
}: {
  projectId: string;
  link: ProjectRepositoryLink;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <RepositoryDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Edit repository link"
    >
      <EditRepositoryLinkForm
        projectId={projectId}
        link={link}
        onClose={() => onOpenChange(false)}
      />
    </RepositoryDialogFrame>
  );
}

function useEditRepositoryLinkForm(
  projectId: string,
  link: ProjectRepositoryLink,
  onClose: () => void,
) {
  const update = useUpdateProjectRepositoryLink();
  const [alias, setAlias] = useState(link.alias);
  const [isPrimary, setIsPrimary] = useState(link.isPrimary);
  const [isolation, setIsolation] = useState(link.isolation);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = () => {
    if (update.isPending) return;
    const patch = linkPatch(link, alias, isPrimary, isolation);
    if (patch === null) return onClose();
    setFailure(null);
    update.mutate(
      { projectId, repositoryId: link.repositoryId, ...patch },
      {
        onSuccess: onClose,
        onError: (error) =>
          setFailure(repositoryFailureMessage(error, "Couldn't save.")),
      },
    );
  };

  return {
    alias,
    setAlias,
    isPrimary,
    setIsPrimary,
    isolation,
    setIsolation,
    failure,
    submit,
    pending: update.isPending,
  };
}

function EditRepositoryLinkForm({
  projectId,
  link,
  onClose,
}: {
  projectId: string;
  link: ProjectRepositoryLink;
  onClose: () => void;
}) {
  const form = useEditRepositoryLinkForm(projectId, link, onClose);
  return (
    <>
      <AliasField alias={form.alias} onAliasChange={form.setAlias} />
      <PrimaryField
        isPrimary={form.isPrimary}
        onIsPrimaryChange={form.setIsPrimary}
      />
      <IsolationPicker value={form.isolation} onChange={form.setIsolation} />
      <DialogFormFooter
        failure={form.failure}
        onCancel={onClose}
        onSubmit={form.submit}
        submitLabel="Save"
        submitDisabled={form.alias.trim() === "" || form.pending}
      />
    </>
  );
}

/** Unlinks one repository: the link goes, the repository, its checkouts, and
 *  their directories stay. The row that opened this shows the failure, since
 *  the confirmation dialog has no room for one. */
function useUnlinkConfirm(
  projectId: string,
  link: ProjectRepositoryLink,
  onOpenChange: (open: boolean) => void,
  onFailure: (message: string) => void,
) {
  const unlink = useUnlinkProjectRepository();
  const confirm = () => {
    unlink.mutate(
      { projectId, repositoryId: link.repositoryId },
      {
        onSuccess: () => onOpenChange(false),
        onError: (error) => {
          onOpenChange(false);
          onFailure(
            repositoryFailureMessage(error, "Couldn't unlink the repository."),
          );
        },
      },
    );
  };
  return { confirm, pending: unlink.isPending };
}

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
  const { confirm, pending } = useUnlinkConfirm(
    projectId,
    link,
    onOpenChange,
    onFailure,
  );

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Unlink repository?"
      description={
        <>
          “{link.alias}” leaves this project. The repository, its checkouts, and
          their directories stay.
        </>
      }
      confirmLabel="Unlink"
      onConfirm={confirm}
      isPending={pending}
    />
  );
}
