"use client";

import { useState } from "react";

import { Alert, AlertAction, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { BrainIcon, PlusIcon } from "lucide-react";

import type { KnowledgeSpaceResponse } from "@/lib/api/generated/models";
import { useSetKnowledgeSpaceArchive } from "@/lib/services/knowledge-spaces/mutations";
import { useKnowledgeSpacesQuery } from "@/lib/services/knowledge-spaces/queries";
import {
  archivedFilter,
  ListViewMenu,
  type ListShow,
} from "../components/chat-list-view";
import {
  KnowledgeSpaceDialogs,
  type KnowledgeSpaceDialogState,
} from "./knowledge-space-dialogs";

/**
 * Owner management for Knowledge Spaces: list, create, rename, and archive.
 * Archive hides a Space from search. It does not delete files.
 */
export function KnowledgeSpaces() {
  const [show, setShow] = useState<ListShow>("active");

  const [dialog, setDialog] = useState<KnowledgeSpaceDialogState>({
    kind: "closed",
  });

  return (
    <TooltipProvider>
      <KnowledgeSpacesPanel
        show={show}
        dialog={dialog}
        onShowChange={setShow}
        onDialog={setDialog}
      />
    </TooltipProvider>
  );
}

type KnowledgeSpacesPanelProps = {
  show: ListShow;
  dialog: KnowledgeSpaceDialogState;
  onShowChange: (show: ListShow) => void;
  onDialog: (dialog: KnowledgeSpaceDialogState) => void;
};

function KnowledgeSpacesIntro() {
  return (
    <p className="text-sm text-muted-foreground">
      Knowledge Spaces keep notes the assistant can search. The id identifies a
      Space, so names can repeat. Archive hides a Space from search and leaves
      its files on disk.
    </p>
  );
}

function KnowledgeSpacesPanel({
  show,
  dialog,
  onShowChange,
  onDialog,
}: KnowledgeSpacesPanelProps) {
  const query = useKnowledgeSpacesQuery(archivedFilter(show));
  const spaces = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <KnowledgeSpacesIntro />
      <KnowledgeSpacesToolbar
        show={show}
        onShowChange={onShowChange}
        onCreate={() => onDialog({ kind: "create" })}
      />
      <KnowledgeSpacesBody
        show={show}
        spaces={spaces}
        isPending={query.isPending}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        onCreate={() => onDialog({ kind: "create" })}
        onRename={(space) => onDialog({ kind: "rename", space })}
        onArchive={(space) => onDialog({ kind: "archive", space })}
      />
      <LoadMoreKnowledgeSpaces
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        isFetchNextPageError={query.isFetchNextPageError}
        onLoadMore={() => void query.fetchNextPage()}
      />
      <KnowledgeSpaceDialogs
        dialog={dialog}
        onClose={() => onDialog({ kind: "closed" })}
      />
    </div>
  );
}

function KnowledgeSpacesToolbar({
  show,
  onShowChange,
  onCreate,
}: {
  show: ListShow;
  onShowChange: (show: ListShow) => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <ListViewMenu show={show} onShowChange={onShowChange} />
      <Button type="button" size="sm" onClick={onCreate}>
        <PlusIcon />
        New Space
      </Button>
    </div>
  );
}

function KnowledgeSpacesBody({
  show,
  spaces,
  isPending,
  isError,
  onRetry,
  onCreate,
  onRename,
  onArchive,
}: {
  show: ListShow;
  spaces: ReadonlyArray<KnowledgeSpaceResponse>;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onCreate: () => void;
  onRename: (space: KnowledgeSpaceResponse) => void;
  onArchive: (space: KnowledgeSpaceResponse) => void;
}) {
  if (isPending) return <KnowledgeSpacesSkeleton />;

  if (isError && spaces.length === 0) {
    return <KnowledgeSpacesError onRetry={onRetry} />;
  }

  if (spaces.length === 0) {
    return <KnowledgeSpacesEmpty show={show} onCreate={onCreate} />;
  }

  return (
    <KnowledgeSpaceList
      spaces={spaces}
      onRename={onRename}
      onArchive={onArchive}
    />
  );
}

function KnowledgeSpacesSkeleton() {
  return (
    <output className="flex flex-col gap-2">
      <span className="sr-only">Loading Knowledge Spaces</span>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </output>
  );
}

function KnowledgeSpacesError({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Could not load Knowledge Spaces.</AlertTitle>
      <AlertAction>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}

function KnowledgeSpacesEmpty({
  show,
  onCreate,
}: {
  show: ListShow;
  onCreate: () => void;
}) {
  const archived = show === "archived";

  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <BrainIcon className="mb-2 size-8" aria-hidden="true" />
      <p className="mb-1.5 text-base font-semibold">
        {archived ? "No archived Knowledge Spaces" : "No Knowledge Spaces yet"}
      </p>
      <p className="mx-auto mb-4 max-w-sm text-sm text-muted-foreground">
        {archived
          ? "Archived Spaces stay on disk and return here until you restore them."
          : "Create a Space to keep notes the assistant can search."}
      </p>
      {archived ? null : (
        <Button type="button" size="sm" onClick={onCreate}>
          <PlusIcon />
          New Space
        </Button>
      )}
    </div>
  );
}

function KnowledgeSpaceList({
  spaces,
  onRename,
  onArchive,
}: {
  spaces: ReadonlyArray<KnowledgeSpaceResponse>;
  onRename: (space: KnowledgeSpaceResponse) => void;
  onArchive: (space: KnowledgeSpaceResponse) => void;
}) {
  return (
    <ul
      aria-label="Knowledge Spaces"
      className="divide-y overflow-hidden rounded-lg border"
    >
      {spaces.map((space) => (
        <KnowledgeSpaceRow
          key={space.id}
          space={space}
          onRename={() => onRename(space)}
          onArchive={() => onArchive(space)}
        />
      ))}
    </ul>
  );
}

function KnowledgeSpaceRow({
  space,
  onRename,
  onArchive,
}: {
  space: KnowledgeSpaceResponse;
  onRename: () => void;
  onArchive: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{space.name}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {space.id}
        </p>
      </div>
      <KnowledgeSpaceRowActions
        space={space}
        onRename={onRename}
        onArchive={onArchive}
      />
    </li>
  );
}

function KnowledgeSpaceRowActions({
  space,
  onRename,
  onArchive,
}: {
  space: KnowledgeSpaceResponse;
  onRename: () => void;
  onArchive: () => void;
}) {
  const unarchive = useSetKnowledgeSpaceArchive();

  if (space.archivedAt !== null) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={unarchive.isPending}
        onClick={() => unarchive.mutate({ id: space.id, archived: false })}
      >
        Unarchive
      </Button>
    );
  }

  return (
    <div className="flex shrink-0 gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onRename}>
        Rename
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onArchive}>
        Archive
      </Button>
    </div>
  );
}

function LoadMoreKnowledgeSpaces({
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onLoadMore,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  onLoadMore: () => void;
}) {
  if (!hasNextPage && !isFetchNextPageError) return null;

  const label = isFetchNextPageError ? "Try again" : "Load more";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="self-center"
      disabled={isFetchingNextPage}
      onClick={onLoadMore}
    >
      {label}
    </Button>
  );
}
