"use client";

import * as React from "react";

import { Alert, AlertAction, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";

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
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
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
    <div className="space-y-6">
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

function RepositoriesHeader({
  onRegister,
  onLink,
  linkDisabled,
}: {
  onRegister: () => void;
  onLink: () => void;
  linkDisabled: boolean;
}) {
  return (
    <CardHeader>
      <CardTitle>Repositories</CardTitle>
      <CardDescription>
        The repositories this project can start chats in. A link keeps the
        project&apos;s own alias and decides whether a chat start takes a
        worktree; the catalog, its checkouts, and their directories belong to
        your account.
      </CardDescription>
      <CardAction>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRegister}>
            Register checkout
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onLink}
            disabled={linkDisabled}
          >
            Link repository
          </Button>
        </div>
      </CardAction>
    </CardHeader>
  );
}

/**
 * The project page's "Repositories" section: the edit surface for the links a
 * chat start resolves its location from, and for the worktrees those links'
 * repositories hold. The catalog is not a page of its own — it appears only as
 * the picker inside these dialogs.
 *
 * @summary link, annotate, and unlink a project's repositories, and remove its
 * clean worktrees
 */
export function ProjectRepositoriesSection({
  projectId,
}: {
  projectId: string;
}) {
  const links = useProjectRepositoryLinksQuery(projectId);
  const checkouts = useCheckoutsQuery();
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [registerOpen, setRegisterOpen] = React.useState(false);

  return (
    <Card>
      <RepositoriesHeader
        onRegister={() => setRegisterOpen(true)}
        onLink={() => setLinkOpen(true)}
        linkDisabled={links.isPending}
      />
      <CardContent>
        <RepositoriesBody
          projectId={projectId}
          links={links}
          checkouts={checkouts}
        />
      </CardContent>
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
    </Card>
  );
}
