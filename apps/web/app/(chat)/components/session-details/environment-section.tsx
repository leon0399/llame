"use client";

import {
  CopyIcon,
  FolderIcon,
  FolderKanbanIcon,
  MonitorIcon,
  MoreHorizontalIcon,
  ServerIcon,
} from "lucide-react";
import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { toast } from "@workspace/ui/components/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";

import { RelativeTime } from "@/components/relative-time";
import { copyText } from "@/lib/clipboard";
import { machinePathFromRoot } from "@/lib/services/machines/locator";
import type { MachineResponse } from "@/lib/services/machines/queries";

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

export interface EnvironmentSectionProps {
  /** Canonical root of the Chat's Workspace binding; null when unbound. */
  workspaceRoot: string | null;
  /** Machine the root names; undefined for a local root. */
  machineName: string | undefined;
  /** Status of that Machine; undefined while loading or when unconfigured. */
  machine: MachineResponse | undefined;
  /** The Chat's Project; null when it has none, undefined while loading. */
  project: EnvironmentProject | null | undefined;
}

async function copyWithNotice(text: string, what: string) {
  if (await copyText(text)) toast.success(`Copied ${what}`);
  else toast.error(`Couldn't copy the ${what}.`);
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
 *  assistive tech and color blindness. */
function MachineStatusBadge({ state }: { state: string }) {
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
}: {
  machineName: string;
  machine: MachineResponse | undefined;
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
      <MachineStatusBadge state={state} />
      {failure === undefined ? null : (
        <p className="px-2 pb-1 pl-8 text-xs text-destructive">{failure}</p>
      )}
    </SidebarMenuItem>
  );
}

/** A Machine path's menu: the path a terminal there takes, or the locator
 *  the tools take. */
function MachinePathMenu({
  path,
  workspaceRoot,
  machineName,
}: {
  path: string;
  workspaceRoot: string;
  machineName: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuAction />}>
        <MoreHorizontalIcon />
        <span className="sr-only">Copy Workspace path</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end">
        <DropdownMenuItem onClick={() => void copyWithNotice(path, "path")}>
          Copy path on {machineName}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void copyWithNotice(workspaceRoot, "locator")}
        >
          Copy locator
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The Workspace root as the path a terminal takes there. Clicking copies it;
 * a Machine root's menu also copies the `machine://` locator the tools take.
 */
function WorkspaceRow({
  workspaceRoot,
  machineName,
}: {
  workspaceRoot: string;
  machineName: string | undefined;
}) {
  const path = machinePathFromRoot(workspaceRoot) ?? workspaceRoot;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        title={`Copy ${path}`}
        onClick={() => void copyWithNotice(path, "path")}
      >
        <FolderIcon />
        <span className="font-mono text-xs">{path}</span>
      </SidebarMenuButton>
      {machineName === undefined ? (
        <SidebarMenuAction
          aria-label="Copy Workspace path"
          onClick={() => void copyWithNotice(path, "path")}
        >
          <CopyIcon />
        </SidebarMenuAction>
      ) : (
        <MachinePathMenu
          path={path}
          workspaceRoot={workspaceRoot}
          machineName={machineName}
        />
      )}
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

/** Where a bound Chat runs and its Workspace path. */
function BoundRows({
  workspaceRoot,
  machineName,
  machine,
}: Omit<EnvironmentSectionProps, "project" | "workspaceRoot"> & {
  workspaceRoot: string;
}) {
  return (
    <>
      {machineName === undefined ? (
        <StaticRow icon={<MonitorIcon />}>This host</StaticRow>
      ) : (
        <MachineRow machineName={machineName} machine={machine} />
      )}
      <WorkspaceRow workspaceRoot={workspaceRoot} machineName={machineName} />
    </>
  );
}

/**
 * The Chat's environment as compact sidebar rows: its Project, where its
 * tools run, and the Workspace path. Rows only appear for what the Chat has.
 */
export function EnvironmentSection({
  workspaceRoot,
  machineName,
  machine,
  project,
}: EnvironmentSectionProps) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Environment</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {project ? <ProjectRow project={project} /> : null}
          {workspaceRoot === null ? (
            <StaticRow icon={<FolderIcon />} muted>
              No Workspace
            </StaticRow>
          ) : (
            <BoundRows
              workspaceRoot={workspaceRoot}
              machineName={machineName}
              machine={machine}
            />
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
