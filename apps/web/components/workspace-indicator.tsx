import { FolderIcon, ServerIcon } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { Badge } from "@workspace/ui/components/badge";
import { cn } from "@workspace/ui/lib/utils";

import { machineNameFromRoot } from "@/lib/services/machines/locator";
import { useMachinesQuery } from "@/lib/services/machines/queries";
import type { MachineResponse } from "@/lib/services/machines/queries";

type MachineStatus = MachineResponse["status"];

/** The final path segment, which is what stays readable in the header. */
function lastPathSegment(workspaceRoot: string): string {
  const withoutTrailingSeparators = workspaceRoot.replace(/\/+$/, "");
  if (withoutTrailingSeparators.length === 0) return workspaceRoot;
  return withoutTrailingSeparators.slice(
    withoutTrailingSeparators.lastIndexOf("/") + 1,
  );
}

function machineStatusWord(status: MachineStatus): string {
  return status === "online" ? "Online" : "Offline";
}

/**
 * The accessible name: the complete locator, plus the Machine's state when the
 * status list knows it. The status is carried here as text rather than only in
 * the dot, so it survives for a screen reader and for color-blindness.
 */
function workspaceAriaLabel(
  workspaceRoot: string,
  machineName: string | undefined,
  status: MachineStatus | undefined,
): string {
  if (machineName === undefined) return `Workspace: ${workspaceRoot}`;
  const state = status === undefined ? "" : `, ${status}`;
  return `Workspace: ${workspaceRoot} (${machineName}${state})`;
}

function MachineStatusDot({ status }: { status: MachineStatus | undefined }) {
  if (status === undefined) return null;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "online" ? "bg-foreground" : "bg-destructive",
      )}
    />
  );
}

function WorkspaceBadgeContents({
  workspaceRoot,
  machineName,
  status,
}: {
  workspaceRoot: string;
  machineName: string | undefined;
  status: MachineStatus | undefined;
}) {
  const text =
    machineName === undefined
      ? lastPathSegment(workspaceRoot)
      : status === undefined
        ? machineName
        : `${machineName} · ${machineStatusWord(status)}`;

  return (
    <>
      {machineName === undefined ? <FolderIcon /> : <ServerIcon />}
      <MachineStatusDot status={status} />
      <span className="truncate">{text}</span>
    </>
  );
}

function WorkspaceTooltip({
  workspaceRoot,
  machineName,
  status,
}: {
  workspaceRoot: string;
  machineName: string | undefined;
  status: MachineStatus | undefined;
}) {
  return (
    <TooltipContent>
      <div>
        <div>{workspaceRoot}</div>
        {machineName === undefined || status === undefined ? null : (
          <div>
            {machineName} is {status}
          </div>
        )}
      </div>
    </TooltipContent>
  );
}

function findMachine(
  machines: ReadonlyArray<MachineResponse> | undefined,
  machineName: string | undefined,
): MachineResponse | undefined {
  if (machineName === undefined) return undefined;
  return machines?.find(
    (entry) => entry.name.toLowerCase() === machineName.toLowerCase(),
  );
}

/**
 * Shows the current Chat Workspace root as compact header metadata. The final
 * path segment keeps the header readable while the tooltip exposes the
 * complete canonical path for inspection.
 *
 * A `machine://<name>/...` root names a remote Machine instead of a local
 * directory, so the indicator labels the Machine and marks whether it is
 * reachable: the same polled status list the settings page reads, looked up by
 * name. An unreachable Machine does not unbound the Workspace — the Chat keeps
 * its binding — so the badge reports the state rather than disappearing.
 */
export function WorkspaceIndicator({
  workspaceRoot,
}: {
  workspaceRoot: string | null;
}) {
  const machineName =
    workspaceRoot === null ? undefined : machineNameFromRoot(workspaceRoot);
  // Local Workspaces never read the Machines list; a Machine Workspace needs
  // it, whether or not that Machine is still configured.
  const { data: machines } = useMachinesQuery(machineName !== undefined);

  if (workspaceRoot === null) return null;

  const machine = findMachine(machines, machineName);
  const status = machine?.status;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            className="max-w-48"
            variant="outline"
            aria-label={workspaceAriaLabel(workspaceRoot, machineName, status)}
            tabIndex={0}
          />
        }
      >
        <WorkspaceBadgeContents
          workspaceRoot={workspaceRoot}
          machineName={machineName}
          status={status}
        />
      </TooltipTrigger>
      <WorkspaceTooltip
        workspaceRoot={workspaceRoot}
        machineName={machineName}
        status={status}
      />
    </Tooltip>
  );
}
