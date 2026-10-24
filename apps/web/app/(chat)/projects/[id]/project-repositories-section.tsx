"use client";

import * as React from "react";

import { Alert, AlertAction, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { ChevronRightIcon, PlusIcon } from "lucide-react";

import { IconButtonTooltip } from "@/components/icon-button-tooltip";

import {
  useCheckoutsQuery,
  type CheckoutsQuery,
} from "@/lib/services/checkouts/queries";
import {
  useRepositoriesQuery,
  type RepositoryResponse,
} from "@/lib/services/repositories/queries";
import { useProjectRepositoryLinksQuery } from "@/lib/services/project/queries";
import type { ProjectRepositoryLink } from "@/lib/services/project/types";

import { DraftRepositoryRow } from "./project-repository-draft-row";
import { countLabel } from "./project-repository-policy";
import {
  RepositorySheet,
  type CheckoutsRead,
} from "./project-repository-sheet";

/** The row's second line: the remote, then what the repository holds. A
 *  repository with no clone says so, since a chat cannot start in it. */
function RepositorySummary({
  repository,
  checkouts,
}: {
  repository: RepositoryResponse | undefined;
  checkouts: CheckoutsRead;
}) {
  // Until the catalog and the checkouts are read, the row claims nothing
  // about them.
  const parts =
    repository === undefined ? [] : [repository.canonicalRemote ?? "No remote"];
  if (checkouts.status === "loaded") {
    const clones = checkouts.rows.filter((row) => row.kind === "main");
    const worktrees = checkouts.rows.length - clones.length;
    parts.push(
      clones.length === 0
        ? "No checkout"
        : countLabel(clones.length, "checkout"),
    );
    if (worktrees > 0) parts.push(countLabel(worktrees, "worktree"));
  }
  return (
    <span className="min-h-4 truncate text-xs text-muted-foreground">
      {parts.join(" · ")}
    </span>
  );
}

type RepositoryRowProps = {
  projectId: string;
  link: ProjectRepositoryLink;
  repository: RepositoryResponse | undefined;
  checkouts: CheckoutsRead;
  showPrimary: boolean;
};

/** One linked repository as one button: its name, Primary when the choice
 *  means something, and a summary line. Everything else is in its sheet. */
function RepositoryRow({ showPrimary, ...props }: RepositoryRowProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <li className="-mx-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">
              {props.link.alias}
            </span>
            {showPrimary && props.link.isPrimary ? (
              <Badge variant="secondary">Primary</Badge>
            ) : null}
          </span>
          <RepositorySummary
            repository={props.repository}
            checkouts={props.checkouts}
          />
        </span>
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </button>
      <RepositorySheet {...props} open={open} onOpenChange={setOpen} />
    </li>
  );
}

/** A failed checkout read, with its retry, as the list's last row; the rows
 *  above then show only their remotes. */
function CheckoutsLoadError({ checkouts }: { checkouts: CheckoutsQuery }) {
  if (!checkouts.isError) return null;
  return (
    <li>
      <Alert variant="destructive">
        <AlertTitle>Could not load the checkouts.</AlertTitle>
        <AlertAction>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void checkouts.refetch()}
          >
            Try again
          </Button>
        </AlertAction>
      </Alert>
    </li>
  );
}

function RepositoriesLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Could not load this project&apos;s repositories.</AlertTitle>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}

/** The reads the section joins: the links, the catalog for their remotes,
 *  and every checkout, read per repository. */
function useRepositoriesSectionData(projectId: string) {
  const links = useProjectRepositoryLinksQuery(projectId);
  const repositories = useRepositoriesQuery();
  const checkouts = useCheckoutsQuery();
  const repositoryById = new Map(
    (repositories.data ?? []).map((repository) => [repository.id, repository]),
  );
  // A read that has not settled is not an empty list: rows and sheets say
  // which it is rather than report no checkouts.
  const checkoutsOf = (repositoryId: string): CheckoutsRead => {
    if (checkouts.isError) return { status: "error" };
    if (checkouts.data === undefined) return { status: "loading" };
    return {
      status: "loaded",
      rows: checkouts.data.filter(
        (checkout) => checkout.repositoryId === repositoryId,
      ),
    };
  };
  return { links, repositoryById, checkoutsOf, checkouts };
}

function RepositoriesEmpty() {
  return (
    <p className="text-xs text-muted-foreground">
      Link the repositories this project works in.
    </p>
  );
}

/** The links, then a failed checkout read and the draft when there is one.
 *  Rows fill on hover and while drafting; the list's gap keeps two filled
 *  rows from touching, as the sidebar's menu does. */
function RepositoriesBody({
  projectId,
  drafting,
  onDraftClose,
}: {
  projectId: string;
  drafting: boolean;
  onDraftClose: () => void;
}) {
  const { links, repositoryById, checkoutsOf, checkouts } =
    useRepositoriesSectionData(projectId);
  if (links.isPending) return <Skeleton className="h-10 w-full" />;
  if (links.isError) {
    return <RepositoriesLoadError onRetry={() => void links.refetch()} />;
  }
  if (links.data.length === 0 && !drafting) return <RepositoriesEmpty />;
  const linked = new Set(links.data.map((link) => link.repositoryId));
  return (
    <ul className="flex flex-col gap-1">
      {links.data.map((link) => (
        <RepositoryRow
          key={link.id}
          projectId={projectId}
          link={link}
          repository={repositoryById.get(link.repositoryId)}
          checkouts={checkoutsOf(link.repositoryId)}
          showPrimary={links.data.length > 1}
        />
      ))}
      <CheckoutsLoadError checkouts={checkouts} />
      {drafting ? (
        <DraftRepositoryRow
          projectId={projectId}
          linkedRepositoryIds={linked}
          onClose={onDraftClose}
        />
      ) : null}
    </ul>
  );
}

/**
 * The project side panel's "Repositories" section: one line per linked
 * repository, and a `+` that adds a draft row to search or paste another. A
 * row opens the repository's sheet, which holds its settings, clones,
 * worktrees, and Unlink, so the panel stays short however many worktrees the
 * project's chats have made.
 *
 * @summary list a project's repositories; add one; open one to manage it
 */
export function ProjectRepositoriesSection({
  projectId,
}: {
  projectId: string;
}) {
  const headingId = React.useId();
  const [drafting, setDrafting] = React.useState(false);
  return (
    <section aria-labelledby={headingId} className="space-y-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-semibold">
          Repositories
        </h2>
        <IconButtonTooltip
          label="Add repository"
          size="icon-sm"
          disabled={drafting}
          onClick={() => setDrafting(true)}
        >
          <PlusIcon />
        </IconButtonTooltip>
      </div>
      <RepositoriesBody
        projectId={projectId}
        drafting={drafting}
        onDraftClose={() => setDrafting(false)}
      />
    </section>
  );
}
