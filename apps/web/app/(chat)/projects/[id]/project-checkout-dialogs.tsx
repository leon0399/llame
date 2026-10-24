"use client";

import { useId, useState } from "react";

import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";

import {
  useRegisterCheckout,
  type RegisterCheckoutInput,
} from "@/lib/services/checkouts/mutations";
import { repositoryFailureMessage } from "@/lib/services/repositories/failure";
import { useRepositoriesQuery } from "@/lib/services/repositories/queries";

import {
  DialogFormFooter,
  RepositoryDialogFrame,
  RepositoryField,
} from "./project-repository-dialog-parts";

function PathField({
  path,
  onPathChange,
}: {
  path: string;
  onPathChange: (path: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Path</Label>
      <Input
        id={id}
        value={path}
        onChange={(event) => onPathChange(event.target.value)}
        maxLength={4096}
        placeholder="/home/you/src/llame or machine://nas/home/you/src/llame"
        // Deliberate: WAI-ARIA dialog pattern moves focus into the modal on
        // open; this is the dialog's primary field.
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      <p className="text-xs text-muted-foreground">
        The executor follows from the path: a plain path is this
        instance&rsquo;s local executor, and{" "}
        <code>machine://&lt;name&gt;/…</code> names a Machine. Registration
        inspects the path with git.
      </p>
    </div>
  );
}

function RemoteField({
  remote,
  onRemoteChange,
}: {
  remote: string;
  onRemoteChange: (remote: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Remote</Label>
      <Input
        id={id}
        value={remote}
        onChange={(event) => onRemoteChange(event.target.value)}
        maxLength={4096}
        placeholder="git@github.com:owner/name.git"
      />
    </div>
  );
}

/** The registration form's state, its submit, and the write it makes. */
function useRegisterCheckoutForm(onClose: () => void) {
  const register = useRegisterCheckout();
  const [path, setPath] = useState("");
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [remote, setRemote] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const submit = () => {
    if (path.trim() === "" || register.isPending) return;
    setFailure(null);
    const variables: RegisterCheckoutInput = { path: path.trim() };
    if (repositoryId !== null) variables.repositoryId = repositoryId;
    if (remote.trim() !== "") variables.remote = remote.trim();
    register.mutate(variables, {
      onSuccess: onClose,
      onError: (error) =>
        setFailure(
          repositoryFailureMessage(error, "Couldn't register the checkout."),
        ),
    });
  };

  return {
    path,
    setPath,
    repositoryId,
    setRepositoryId,
    remote,
    setRemote,
    failure,
    submit,
    pending: register.isPending,
  };
}

/**
 * Registers one checkout by its path. No executor field: the route derives the
 * executor from the path itself — a plain path is this instance's local
 * executor, and `machine://<name>/…` names a Machine. The repository and the
 * remote are optional selectors; with neither, the inspected `origin` decides,
 * and a repository llame has not seen is adopted.
 *
 * @summary register a clone or worktree on this instance or a Machine
 */
export function RegisterCheckoutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <RepositoryDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Register checkout"
    >
      <RegisterCheckoutForm onClose={() => onOpenChange(false)} />
    </RepositoryDialogFrame>
  );
}

function RegisterCheckoutForm({ onClose }: { onClose: () => void }) {
  const form = useRegisterCheckoutForm(onClose);
  const repositories = useRepositoriesQuery();
  return (
    <>
      <PathField path={form.path} onPathChange={form.setPath} />
      <RepositoryField
        repositories={repositories.data ?? []}
        selectedId={form.repositoryId}
        onSelect={form.setRepositoryId}
        noneLabel="Let git decide from the remote"
        hint="Optional. A selector only selects: the inspected origin still decides, and a clone llame has not seen is adopted."
      />
      <RemoteField remote={form.remote} onRemoteChange={form.setRemote} />
      <DialogFormFooter
        failure={form.failure}
        onCancel={onClose}
        onSubmit={form.submit}
        submitLabel="Register"
        submitDisabled={form.path.trim() === "" || form.pending}
      />
    </>
  );
}
