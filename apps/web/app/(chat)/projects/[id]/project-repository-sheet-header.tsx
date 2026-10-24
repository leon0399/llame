"use client";

import { useState } from "react";

import { Button, buttonVariants } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  SheetClose,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { MoreHorizontalIcon, XIcon } from "lucide-react";

import { ForgeMark } from "@/components/forge-mark";
import type { ProjectRepositoryLink } from "@/lib/services/project/types";
import { forgePage } from "@/lib/services/repositories/forge";
import type { RepositoryResponse } from "@/lib/services/repositories/queries";

import {
  Refusal,
  UnlinkRepositoryLinkDialog,
} from "./project-repository-dialogs";

/** Unlink, which is rare enough to sit behind a menu rather than earn a
 *  button of its own. */
function RepositoryMenu({ onUnlink }: { onUnlink: () => void }) {
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
          <MoreHorizontalIcon />
          <span className="sr-only">More actions</span>
        </TooltipTrigger>
        <TooltipContent side="bottom">More actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem variant="destructive" onSelect={onUnlink}>
          Unlink from project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The repository's page on its forge, in a new tab; absent where the remote
 *  cannot be known to have one. */
function ForgeLink({ remote }: { remote: string | null }) {
  const page = forgePage(remote);
  if (page === undefined) return null;
  const label = `Open on ${page.name}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // A link styled as the toolbar's icon buttons; Button would give
          // it the button role.
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          />
        }
      >
        <ForgeMark forge={page.name} />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The header's toolbar, every action in one cluster at the edge the close
 *  button anchors: the forge page, the menu, then close. */
function HeaderActions({
  remote,
  onUnlink,
}: {
  remote: string | null;
  onUnlink: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center">
      <ForgeLink remote={remote} />
      <RepositoryMenu onUnlink={onUnlink} />
      <Tooltip>
        <TooltipTrigger
          render={
            <SheetClose render={<Button variant="ghost" size="icon-sm" />} />
          }
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </TooltipTrigger>
        <TooltipContent side="bottom">Close</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function RepositoryHeader({
  projectId,
  link,
  repository,
}: {
  projectId: string;
  link: ProjectRepositoryLink;
  repository: RepositoryResponse | undefined;
}) {
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const remote = repository?.canonicalRemote ?? null;
  return (
    <SheetHeader>
      {/* The title block takes the width; the toolbar keeps its place at the
          edge however long the name is. */}
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
          <SheetTitle>{link.alias}</SheetTitle>
          <SheetDescription>
            <code className="font-mono text-xs break-all">
              {remote ?? "No remote recorded"}
            </code>
          </SheetDescription>
        </div>
        <HeaderActions remote={remote} onUnlink={() => setUnlinkOpen(true)} />
      </div>
      <Refusal message={failure} />
      <UnlinkRepositoryLinkDialog
        projectId={projectId}
        link={link}
        open={unlinkOpen}
        onOpenChange={setUnlinkOpen}
        onFailure={setFailure}
      />
    </SheetHeader>
  );
}
