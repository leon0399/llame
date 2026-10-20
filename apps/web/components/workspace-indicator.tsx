import { FolderIcon, ServerIcon } from "lucide-react";

import { Badge } from "@workspace/ui/components/badge";
import { cn } from "@workspace/ui/lib/utils";

import {
  findMachineByName,
  machineNameFromRoot,
  machinePathFromRoot,
} from "@/lib/services/machines/locator";
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
        status === "online" ? "bg-success" : "bg-destructive",
      )}
    />
  );
}

/**
 * Compact header summary of the Chat Workspace: the Machine and its state for
 * a `machine://` root, else the root's final segment. It opens the context
 * panel, which shows the complete root with a copy action.
 *
 * An unreachable Machine does not unbind the Workspace — the Chat keeps its
 * binding — so the badge reports the state rather than disappearing.
 */
export function WorkspaceIndicator({
  workspaceRoot,
  expanded,
  onActivate,
}: {
  workspaceRoot: string | null;
  /** Whether the context panel this badge opens is showing. */
  expanded: boolean;
  onActivate: () => void;
}) {
  const machineName =
    workspaceRoot === null ? undefined : machineNameFromRoot(workspaceRoot);
  // Local Workspaces never read the Machines list; a Machine Workspace needs
  // it, whether or not that Machine is still configured.
  const { data: machines } = useMachinesQuery(machineName !== undefined);

  if (workspaceRoot === null) return null;

  const status = findMachineByName(machines, machineName)?.status;
  // A Machine root's own path, so `machine://devl/` reads as `/`, not `devl`.
  const segment = lastPathSegment(
    machinePathFromRoot(workspaceRoot) ?? workspaceRoot,
  );
  // Offline is spelled out, not left to the dot's color alone.
  const text =
    machineName === undefined
      ? segment
      : `${machineName} · ${segment}${status === "offline" ? " · Offline" : ""}`;
  return (
    <Badge
      className="max-w-56"
      variant="outline"
      render={
        <button
          type="button"
          aria-label={workspaceAriaLabel(workspaceRoot, machineName, status)}
          aria-expanded={expanded}
          onClick={onActivate}
        />
      }
    >
      {machineName === undefined ? <FolderIcon /> : <ServerIcon />}
      <MachineStatusDot status={status} />
      <span className="truncate">{text}</span>
    </Badge>
  );
}
