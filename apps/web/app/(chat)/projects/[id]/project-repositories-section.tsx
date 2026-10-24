"use client";

import * as React from "react";

import { Alert, AlertAction, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { PlusIcon } from "lucide-react";

import { useCheckoutsQuery } from "@/lib/services/checkouts/queries";
import type { CheckoutsQuery } from "@/lib/services/checkouts/queries";
import { useRepositoriesQuery } from "@/lib/services/repositories/queries";
import { useProjectRepositoryLinksQuery } from "@/lib/services/project/queries";
import type { ProjectRepositoryLinksQuery } from "@/lib/services/project/queries";

import { RegisterCheckoutDialog } from "./project-checkout-dialogs";
import { LinkRepositoryDialog } from "./project-repository-dialogs";
import { LinksList, WorktreesList } from "./project-repository-rows";

function LinksSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function LinksLoadError({ onRetry }: { onRetry: () => void }) {
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

/** The two lists, once the links have settled. The catalog and the checkouts
 *  load beside them; a worktree needs both a link and its repository. */
function RepositoriesBody({
  projectId,
  links,
  checkouts,
}: {
  projectId: string;
  links: ProjectRepositoryLinksQuery;
  checkouts: CheckoutsQuery;
}) {
  const repositories = useRepositoriesQuery();
  const linkedIds = new Set(
    (links.data ?? []).map((link) => link.repositoryId),
  );

  if (links.isPending) return <LinksSkeleton />;
  if (links.isError) {
    return <LinksLoadError onRetry={() => void links.refetch()} />;
  }
  return (
    <div className="space-y-4">
      <LinksList
        projectId={projectId}
        links={links.data}
        repositories={repositories.data ?? []}
      />
      <WorktreesList
        worktrees={(checkouts.data ?? []).filter(
          (checkout) =>
            checkout.kind === "worktree" &&
            linkedIds.has(checkout.repositoryId),
        )}
        loading={checkouts.isPending}
        failed={checkouts.isError}
        onRetry={() => void checkouts.refetch()}
      />
    </div>
  );
}

/** The section's one action: a + menu holding both writes, so the narrow
 *  panel header carries a single icon instead of two labelled buttons. */
function AddRepositoryMenu({
  onRegister,
  onLink,
  linkDisabled,
}: {
  onRegister: () => void;
  onLink: () => void;
  linkDisabled: boolean;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" />}
            />
          }
        >
          <PlusIcon />
          <span className="sr-only">Add repository</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          Add repository
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={onLink} disabled={linkDisabled}>
          Link repository
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRegister}>
          Register checkout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RepositoriesHeader({
  headingId,
  ...menu
}: { headingId: string } & React.ComponentProps<typeof AddRepositoryMenu>) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 id={headingId} className="text-sm font-semibold">
        Repositories
      </h2>
      <AddRepositoryMenu {...menu} />
    </div>
  );
}

/**
 * The project side panel's "Repositories" section: the edit surface for the
 * links a chat start resolves its location from, and for the worktrees those
 * links' repositories hold. It sits beside the composer, above the chats, so
 * an endless chat list never pushes it out of reach. The catalog is not a
 * page of its own — it appears only as the picker inside these dialogs.
 *
 * @summary link, annotate, and unlink a project's repositories, and remove its
 * clean worktrees
 */
export function ProjectRepositoriesSection({
  projectId,
}: {
  projectId: string;
}) {
  const headingId = React.useId();
  const links = useProjectRepositoryLinksQuery(projectId);
  const checkouts = useCheckoutsQuery();
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [registerOpen, setRegisterOpen] = React.useState(false);

  return (
    <section aria-labelledby={headingId} className="space-y-3 p-4">
      <RepositoriesHeader
        headingId={headingId}
        onRegister={() => setRegisterOpen(true)}
        onLink={() => setLinkOpen(true)}
        linkDisabled={links.isPending}
      />
      <RepositoriesBody
        projectId={projectId}
        links={links}
        checkouts={checkouts}
      />
      <LinkRepositoryDialog
        projectId={projectId}
        linkedRepositoryIds={
          new Set((links.data ?? []).map((link) => link.repositoryId))
        }
        open={linkOpen}
        onOpenChange={setLinkOpen}
      />
      <RegisterCheckoutDialog
        open={registerOpen}
        onOpenChange={setRegisterOpen}
      />
    </section>
  );
}
