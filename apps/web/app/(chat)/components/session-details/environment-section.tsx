"use client";

import type { ReactNode } from "react";
import {
  BookMarkedIcon,
  ArrowUpRightIcon,
  FolderIcon,
  GitBranchIcon,
  FolderKanbanIcon,
  MonitorIcon,
  ServerIcon,
} from "lucide-react";
import Link from "next/link";

import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@workspace/ui/components/sidebar";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";

import { RelativeTime } from "@/components/relative-time";
import { CopyPathButton } from "@/components/copy-path-button";
import { ForgeMark } from "@/components/forge-mark";
import { machinePathFromRoot } from "@/lib/services/machines/locator";
import type { MachineResponse } from "@/lib/services/machines/queries";
import { forgePage } from "@/lib/services/repositories/forge";

const FAILURE_LABELS: Record<
  NonNullable<MachineResponse["failureReason"]>,
  string
> = {
  unreachable: "Could not be reached",
  host_key_mismatch: "Host key does not match",
  auth_failed: "Authentication failed",
  incompatible_version: "Incompatible protocol version",
  session_lost: "Connection lost",
};

export interface EnvironmentProject {
  id: string;
  name: string;
}

/** The registered checkout a Workspace root is. */
export interface EnvironmentCheckout {
  /** The repository, under the name the Chat's Project gives it. */
  repository: string;
  /** Its canonical remote, null when it has none. */
  remote: string | null;
  kind: "main" | "worktree";
  /** Null for a detached HEAD. */
  branch: string | null;
}

export interface EnvironmentSectionProps {
  /** False until the Chat's card is in the cache; every row is a skeleton
   *  until then. */
  chatLoaded: boolean;
  /** Canonical root of the Chat's Workspace binding; null when unbound. */
  workspaceRoot: string | null;
  /** The checkout that root is; null when it is none, undefined while the
   *  checkout and repository reads settle. */
  checkout: EnvironmentCheckout | null | undefined;
  /** Machine the root names; undefined for a local root. */
  machineName: string | undefined;
  /** Status of that Machine; undefined while loading or when unconfigured. */
  machine: MachineResponse | undefined;
  /** True while the Machines list is still loading. */
  machineLoading: boolean;
  /** The Chat's Project; null when it has none, undefined while loading. */
  project: EnvironmentProject | null | undefined;
}

/** A row that states a fact without acting on it. */
function StaticRow({
  icon,
  muted = false,
  children,
}: {
  icon: React.ReactNode;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <SidebarMenuItem>
      <span
        className={cn(
          "flex h-8 min-w-0 items-center gap-2 px-2 text-sm [&>svg]:size-4 [&>svg]:shrink-0",
          muted && "text-muted-foreground",
        )}
      >
        {icon}
        <span className="truncate">{children}</span>
      </span>
    </SidebarMenuItem>
  );
}

/** When the hub last reached the Machine, kept current while shown. */
function LastSeen({ machine }: { machine: MachineResponse | undefined }) {
  if (machine === undefined) return <>Status unknown</>;
  if (machine.lastSeenAt === null) return <>Never connected</>;
  return (
    <>
      Last seen <RelativeTime date={machine.lastSeenAt} />
    </>
  );
}

function machineState(machine: MachineResponse | undefined) {
  if (machine === undefined) return "Unknown";
  return machine.status === "online" ? "Online" : "Offline";
}

/** The Machine's state as a dot and a word; the word carries it for
 *  assistive tech and color blindness. A skeleton while it loads. */
function MachineStatusBadge({
  state,
  loading,
}: {
  state: string;
  loading: boolean;
}) {
  if (loading) {
    return (
      <SidebarMenuBadge>
        <Skeleton className="h-3 w-12" />
      </SidebarMenuBadge>
    );
  }
  return (
    <SidebarMenuBadge>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            state === "Online"
              ? "bg-success"
              : state === "Offline"
                ? "bg-destructive"
                : "bg-muted-foreground",
          )}
        />
        {state}
      </span>
    </SidebarMenuBadge>
  );
}

/** The Machine the Workspace is on, its state, and why it is offline. */
function MachineRow({
  machineName,
  machine,
  loading,
}: {
  machineName: string;
  machine: MachineResponse | undefined;
  loading: boolean;
}) {
  const failure =
    machine?.status === "offline" && machine.failureReason !== null
      ? FAILURE_LABELS[machine.failureReason]
      : undefined;
  const state = machineState(machine);

  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              // The state is part of the link's name, not only the badge
              // beside it, so a screen reader hears "devl, Offline".
              aria-label={`${machineName}, ${state}`}
              render={<Link href="/settings" prefetch={false} />}
            />
          }
        >
          <ServerIcon />
          <span>{machineName}</span>
        </TooltipTrigger>
        <TooltipContent side="left">
          <LastSeen machine={machine} />
        </TooltipContent>
      </Tooltip>
      <MachineStatusBadge state={state} loading={loading} />
      {failure === undefined ? null : (
        <p className="px-2 pb-1 pl-8 text-xs text-destructive">{failure}</p>
      )}
    </SidebarMenuItem>
  );
}

/**
 * The Workspace root as the path a terminal takes there. The row only states
 * it; its one action copies it — or, for a Machine root, offers the path on
 * that Machine and the `machine://` locator the tools take.
 */
function WorkspaceRow({ workspaceRoot }: { workspaceRoot: string }) {
  const path = machinePathFromRoot(workspaceRoot) ?? workspaceRoot;
  return (
    <SidebarMenuItem>
      <span className="flex h-8 min-w-0 items-center gap-2 pr-8 pl-2 text-sm [&>svg]:size-4 [&>svg]:shrink-0">
        <FolderIcon />
        <span className="truncate font-mono text-xs">{path}</span>
      </span>
      <CopyPathButton
        location={workspaceRoot}
        trigger={<SidebarMenuAction />}
      />
    </SidebarMenuItem>
  );
}

/**
 * The repository the Workspace is a checkout of. On a known forge the row is
 * the link to its page, named the way the forge names it (`owner/name`) under
 * the forge's mark, with an outward arrow that says the link leaves llame.
 * Elsewhere it states the remote, or the repository's name when it has none.
 */
function RepositoryRow({ checkout }: { checkout: EnvironmentCheckout }) {
  const page = forgePage(checkout.remote);
  if (page === undefined) {
    return (
      <StaticRow icon={<BookMarkedIcon />}>
        <span className="font-mono text-xs">
          {checkout.remote ?? checkout.repository}
        </span>
      </StaticRow>
    );
  }
  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              render={
                <a
                  href={page.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${page.slug} on ${page.name}, opens in a new tab`}
                />
              }
            />
          }
        >
          <ForgeMark forge={page.name} />
          <span className="min-w-0 flex-1 truncate">{page.slug}</span>
          <ArrowUpRightIcon className="text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent side="left">Open on {page.name}</TooltipContent>
      </Tooltip>
    </SidebarMenuItem>
  );
}

/** The branch the Workspace has checked out, marked when the Workspace is a
 *  worktree rather than the clone itself. */
function BranchRow({ checkout }: { checkout: EnvironmentCheckout }) {
  return (
    <SidebarMenuItem>
      <span className="flex h-8 min-w-0 items-center gap-2 pr-2 pl-2 text-sm [&>svg]:size-4 [&>svg]:shrink-0">
        <GitBranchIcon />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {checkout.branch ?? "Detached HEAD"}
        </span>
        {checkout.kind === "worktree" ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            Worktree
          </span>
        ) : null}
      </span>
    </SidebarMenuItem>
  );
}

function ProjectRow({ project }: { project: EnvironmentProject }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={`/projects/${project.id}`} prefetch={false} />}
      >
        <FolderKanbanIcon />
        <span>{project.name}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Where a bound Chat runs, the repository and branch it is in when the
 *  root is a registered checkout, and its Workspace path. */
function BoundRows({
  workspaceRoot,
  checkout,
  machineName,
  machine,
  machineLoading,
}: Pick<
  EnvironmentSectionProps,
  "checkout" | "machineName" | "machine" | "machineLoading"
> & {
  workspaceRoot: string;
}) {
  return (
    <>
      {machineName === undefined ? (
        <StaticRow icon={<MonitorIcon />}>This host</StaticRow>
      ) : (
        <MachineRow
          machineName={machineName}
          machine={machine}
          loading={machineLoading}
        />
      )}
      {checkout == null ? null : (
        <>
          <RepositoryRow checkout={checkout} />
          <BranchRow checkout={checkout} />
        </>
      )}
      <WorkspaceRow workspaceRoot={workspaceRoot} />
    </>
  );
}

/** A loading row: the shadcn menu skeleton in its list item. */
function SkeletonRow() {
  return (
    <SidebarMenuItem>
      <SidebarMenuSkeleton showIcon />
    </SidebarMenuItem>
  );
}

function ProjectSlot({
  project,
}: {
  project: EnvironmentProject | null | undefined;
}) {
  if (project === undefined) return <SkeletonRow />;
  return project === null ? null : <ProjectRow project={project} />;
}

/**
 * The Chat's environment as compact sidebar rows: its Project, where its
 * tools run, and the Workspace path. Rows only appear for what the Chat has;
 * what is still loading shows as skeleton rows of the same height.
 */
export function EnvironmentSection(props: EnvironmentSectionProps) {
  if (!props.chatLoaded) {
    return (
      <SidebarMenu>
        <SkeletonRow />
        <SkeletonRow />
      </SidebarMenu>
    );
  }
  const { workspaceRoot } = props;
  return (
    <SidebarMenu>
      <ProjectSlot project={props.project} />
      {workspaceRoot === null ? (
        <StaticRow icon={<FolderIcon />} muted>
          No Workspace
        </StaticRow>
      ) : (
        <BoundRows {...props} workspaceRoot={workspaceRoot} />
      )}
    </SidebarMenu>
  );
}

/** The folded section's one line: where the Chat is, most specific first; a
 *  skeleton until the Chat is known. */
export function environmentSummary({
  chatLoaded,
  workspaceRoot,
  machineName,
  project,
}: EnvironmentSectionProps): ReactNode {
  if (!chatLoaded) return <Skeleton className="h-3 w-16" />;
  if (workspaceRoot === null) return project?.name ?? "No Workspace";
  const path = machinePathFromRoot(workspaceRoot) ?? workspaceRoot;
  const folder = path.replace(/\/+$/, "").split("/").pop() || path;
  return machineName === undefined ? folder : `${machineName} · ${folder}`;
}
