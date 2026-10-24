"use client";

import * as React from "react";

import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { MoreHorizontalIcon, Trash2Icon } from "lucide-react";

import { IconButtonTooltip } from "@/components/icon-button-tooltip";
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

/** The two writes one link row offers, behind one menu named for the row. */
function LinkActions({
  alias,
  onEdit,
  onUnlink,
}: {
  alias: string;
  onEdit: () => void;
  onUnlink: () => void;
}) {
  const label = `Actions for ${alias}`;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" className="ml-auto" />
              }
            />
          }
        >
          <MoreHorizontalIcon />
          <span className="sr-only">{label}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onUnlink}>
          Unlink
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One link's facts: the project's alias first, then the flags a chat start
 *  reads — primary and isolation — then the catalog's remote, which decides
 *  which clones belong to this repository. A long remote truncates; its
 *  title carries the whole value. */
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
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">{link.alias}</span>
        {link.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
        <LinkActions alias={link.alias} onEdit={onEdit} onUnlink={onUnlink} />
      </div>
      <span className="text-xs text-muted-foreground">
        {isolationLabel(link.isolation)}
      </span>
      <code
        className="truncate font-mono text-xs text-muted-foreground"
        title={remote}
      >
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
    <li className="flex min-w-0 flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
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
      <h3 id={headingId} className="text-xs font-medium text-muted-foreground">
        Linked
      </h3>
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No repository is linked yet. Chats started here have no location.
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

/** The branch first — the name a reader knows the tree by — then the path,
 *  truncated with its whole value in the title and the Remove tooltip. */
function WorktreeSummary({
  checkout,
  onRemove,
}: {
  checkout: CheckoutResponse;
  onRemove: () => void;
}) {
  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        {checkout.branch === null ? (
          <span className="text-sm font-medium">Detached HEAD</span>
        ) : (
          <code className="truncate font-mono text-sm font-medium">
            {checkout.branch}
          </code>
        )}
        <IconButtonTooltip
          label={`Remove ${checkout.path}`}
          size="icon-sm"
          className="ml-auto"
          onClick={onRemove}
        >
          <Trash2Icon />
        </IconButtonTooltip>
      </div>
      <code
        className="truncate font-mono text-xs text-muted-foreground"
        title={checkout.path}
      >
        {checkout.path}
      </code>
    </>
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
    <dl className="space-y-0.5 text-xs">
      <div className="flex gap-2">
        <dt className="w-20 shrink-0 text-muted-foreground">Created by</dt>
        <dd className="min-w-0">
          {checkout.leaseChatId === null ? (
            <span className="text-muted-foreground">No chat recorded</span>
          ) : (
            <ChatReference chatId={checkout.leaseChatId} />
          )}
        </dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-20 shrink-0 text-muted-foreground">Bound chats</dt>
        <dd className="min-w-0">
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
    <li className="flex min-w-0 flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
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
        No worktree is recorded for this project.
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
      <h3 id={headingId} className="text-xs font-medium text-muted-foreground">
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
