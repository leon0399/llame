"use client";

import * as React from "react";

import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { useChatQuery } from "@/lib/services/chat/queries";
import { useRemoveCheckoutWorktree } from "@/lib/services/checkouts/mutations";
import type { CheckoutResponse } from "@/lib/services/checkouts/queries";
import { repositoryFailureMessage } from "@/lib/services/repositories/failure";
import type { RepositoryResponse } from "@/lib/services/repositories/queries";
import type { ProjectRepositoryLink } from "@/lib/services/project/types";

import {
  EditRepositoryLinkDialog,
  UnlinkRepositoryLinkDialog,
} from "./project-repository-dialogs";
import { isolationLabel } from "./project-repository-policy";

/** One chat, by its title. A worktree records ids, and two ids would say
 *  nothing to a reader, so each one resolves through the owner chat read. */
function ChatReference({ chatId }: { chatId: string }) {
  const { data } = useChatQuery(chatId);
  if (data === undefined) {
    return <span className="text-muted-foreground">…</span>;
  }
  return <span className="font-medium">{data.title ?? "Untitled chat"}</span>;
}

/** A refusal that belongs to one row, in that row's own words. */
function RowFailure({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>{message}</AlertTitle>
    </Alert>
  );
}

/** The two writes one link row offers, named for the row they act on. */
function LinkActions({
  alias,
  onEdit,
  onUnlink,
}: {
  alias: string;
  onEdit: () => void;
  onUnlink: () => void;
}) {
  return (
    <div className="ml-auto flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onEdit}
        aria-label={`Edit ${alias}`}
      >
        Edit
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onUnlink}
        aria-label={`Unlink ${alias}`}
      >
        Unlink
      </Button>
    </div>
  );
}

/** One link's facts: the project's alias first, then the flags a chat start
 *  reads — primary and isolation — then the catalog's remote, which decides
 *  which clones belong to this repository. */
function LinkSummary({
  link,
  remote,
  onEdit,
  onUnlink,
}: {
  link: ProjectRepositoryLink;
  remote: string | undefined;
  onEdit: () => void;
  onUnlink: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{link.alias}</span>
        {link.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
        <span className="text-sm text-muted-foreground">
          {isolationLabel(link.isolation)}
        </span>
        <LinkActions alias={link.alias} onEdit={onEdit} onUnlink={onUnlink} />
      </div>
      <code className="font-mono text-xs break-all text-muted-foreground">
        {remote ?? "No remote recorded"}
      </code>
    </>
  );
}

function LinkRow({
  projectId,
  link,
  remote,
}: {
  projectId: string;
  link: ProjectRepositoryLink;
  remote: string | undefined;
}) {
  const [editOpen, setEditOpen] = React.useState(false);
  const [unlinkOpen, setUnlinkOpen] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <LinkSummary
        link={link}
        remote={remote}
        onEdit={() => setEditOpen(true)}
        onUnlink={() => setUnlinkOpen(true)}
      />
      <RowFailure message={failure} />
      <EditRepositoryLinkDialog
        projectId={projectId}
        link={link}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <UnlinkRepositoryLinkDialog
        projectId={projectId}
        link={link}
        open={unlinkOpen}
        onOpenChange={setUnlinkOpen}
        onFailure={setFailure}
      />
    </li>
  );
}

/** Every repository the project links, each under the alias the project gave
 *  it and the remote the catalog records. */
export function LinksList({
  projectId,
  links,
  repositories,
}: {
  projectId: string;
  links: ReadonlyArray<ProjectRepositoryLink>;
  repositories: ReadonlyArray<RepositoryResponse>;
}) {
  const headingId = React.useId();
  const byId = new Map(
    repositories.map((repository) => [repository.id, repository]),
  );

  return (
    <section aria-labelledby={headingId} className="space-y-1">
      <h3 id={headingId} className="text-sm font-semibold">
        Linked repositories
      </h3>
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No repository is linked yet. A chat that starts in this project
          resolves its location from these links, so without one it starts
          unbound.
        </p>
      ) : (
        <ul className="divide-y">
          {links.map((link) => (
            <LinkRow
              key={link.id}
              projectId={projectId}
              link={link}
              remote={byId.get(link.repositoryId)?.canonicalRemote ?? undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function WorktreeSummary({
  checkout,
  onRemove,
}: {
  checkout: CheckoutResponse;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <code className="block font-mono text-xs break-all">
          {checkout.path}
        </code>
        <p className="text-sm text-muted-foreground">
          {checkout.branch === null ? (
            "Detached HEAD"
          ) : (
            <code className="font-mono text-xs">{checkout.branch}</code>
          )}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRemove}
        aria-label={`Remove ${checkout.path}`}
      >
        Remove
      </Button>
    </div>
  );
}

/** Every chat whose Workspace root is this worktree's path. */
function BoundChats({ chatIds }: { chatIds: ReadonlyArray<string> }) {
  if (chatIds.length === 0) {
    return <span className="text-muted-foreground">None</span>;
  }
  return (
    <span className="flex flex-wrap gap-x-1">
      {chatIds.map((chatId, index) => (
        <span key={chatId}>
          {index > 0 ? ", " : null}
          <ChatReference chatId={chatId} />
        </span>
      ))}
    </span>
  );
}

function WorktreeChats({ checkout }: { checkout: CheckoutResponse }) {
  return (
    <dl className="space-y-1 text-sm">
      <div className="flex gap-3">
        <dt className="w-24 shrink-0 text-muted-foreground">Created by</dt>
        <dd>
          {checkout.leaseChatId === null ? (
            <span className="text-muted-foreground">No chat recorded</span>
          ) : (
            <ChatReference chatId={checkout.leaseChatId} />
          )}
        </dd>
      </div>
      <div className="flex gap-3">
        <dt className="w-24 shrink-0 text-muted-foreground">Bound chats</dt>
        <dd>
          <BoundChats chatIds={checkout.chatIds} />
        </dd>
      </div>
    </dl>
  );
}

/** The removal write: a refusal closes the confirmation and reaches the row,
 *  which keeps it listed beside the server's sentence. */
function useRemoveWorktree(
  checkout: CheckoutResponse,
  onOpenChange: (open: boolean) => void,
  onRefused: (message: string) => void,
) {
  const remove = useRemoveCheckoutWorktree();
  return {
    pending: remove.isPending,
    confirm: () =>
      remove.mutate(checkout.id, {
        onSuccess: () => onOpenChange(false),
        onError: (error) => {
          onOpenChange(false);
          onRefused(
            repositoryFailureMessage(error, "Couldn't remove the worktree."),
          );
        },
      }),
  };
}

/** The guarded removal: the route refuses a dirty tree or unpushed commits. */
function RemoveWorktreeDialog({
  checkout,
  open,
  onOpenChange,
  onRefused,
}: {
  checkout: CheckoutResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefused: (message: string) => void;
}) {
  const remove = useRemoveWorktree(checkout, onOpenChange, onRefused);
  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Remove worktree?"
      description={
        <>
          The directory at{" "}
          <code className="font-mono text-xs">{checkout.path}</code> is removed
          and its row forgotten. A dirty tree, an unpushed commit, or an unknown
          upstream refuses the removal; the branch stays either way.
        </>
      }
      confirmLabel="Remove"
      isPending={remove.pending}
      onConfirm={remove.confirm}
    />
  );
}

function WorktreeRow({ checkout }: { checkout: CheckoutResponse }) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <WorktreeSummary
        checkout={checkout}
        onRemove={() => setConfirmOpen(true)}
      />
      <WorktreeChats checkout={checkout} />
      <RowFailure message={refusal} />
      <RemoveWorktreeDialog
        checkout={checkout}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onRefused={setRefusal}
      />
    </li>
  );
}

function WorktreesState({
  worktrees,
  loading,
  failed,
  onRetry,
}: {
  worktrees: ReadonlyArray<CheckoutResponse>;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  if (failed) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load this project&apos;s worktrees.</AlertTitle>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </Alert>
    );
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading worktrees…</p>;
  }
  if (worktrees.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No worktree is recorded for this project. A chat that starts a worktree
        lists it here.
      </p>
    );
  }
  return (
    <ul className="divide-y">
      {worktrees.map((checkout) => (
        <WorktreeRow key={checkout.id} checkout={checkout} />
      ))}
    </ul>
  );
}

/** The project's worktrees: one per tree a chat created, each naming the chat
 *  whose lease records it and every chat bound to its path. */
export function WorktreesList({
  worktrees,
  loading,
  failed,
  onRetry,
}: {
  worktrees: ReadonlyArray<CheckoutResponse>;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className="space-y-1">
      <h3 id={headingId} className="text-sm font-semibold">
        Worktrees
      </h3>
      <WorktreesState
        worktrees={worktrees}
        loading={loading}
        failed={failed}
        onRetry={onRetry}
      />
    </section>
  );
}
