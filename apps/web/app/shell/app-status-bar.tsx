"use client";

import { GaugeIcon, ServerIcon } from "lucide-react";
import Link from "next/link";

import {
  StatusBar,
  StatusBarGroup,
  StatusBarItem,
} from "@workspace/ui/components/status-bar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";

import { DemoChip } from "@/app/shell/soon-chip";
import type { MachineResponse } from "@/lib/services/machines/queries";
import { useMachinesQuery } from "@/lib/services/machines/queries";

/** At most this many Machines are named; the count covers the rest. */
const NAMED_MACHINES = 3;

/** TODO(#1357): a meter of real allowance use; fixed at the sample 58%. */
function UsageMeter() {
  return (
    <span className="relative block h-1.5 w-8 overflow-hidden rounded-full bg-sidebar-accent">
      <span className="block h-full w-7/12 rounded-full bg-sidebar-foreground" />
    </span>
  );
}

/** TODO(#1357): each subscription provider's 5-hour and weekly allowance
 *  use in place of these static sample values. */
function DemoUsage() {
  return (
    <StatusBarGroup>
      <DemoChip />
      <StatusBarItem>
        <GaugeIcon aria-hidden="true" />
        Codex
        <UsageMeter />
        58% 5h · 41% wk
      </StatusBarItem>
    </StatusBarGroup>
  );
}

function MachineDot({ status }: { status: MachineResponse["status"] }) {
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
 * The configured Machines at a glance: the first few by name with their
 * state, and how many are online. Kept current by live updates; nothing is
 * shown on an instance without Machines.
 */
function MachinesOverview() {
  const { data: machines } = useMachinesQuery();
  if (machines === undefined || machines.length === 0) return null;

  const online = machines.filter((m) => m.status === "online").length;
  return (
    <StatusBarGroup>
      {machines.slice(0, NAMED_MACHINES).map((machine) => (
        <StatusBarItem
          key={machine.name}
          aria-label={`${machine.name}, ${machine.status}`}
        >
          <MachineDot status={machine.status} />
          {machine.name}
        </StatusBarItem>
      ))}
      <Tooltip>
        <TooltipTrigger
          render={<StatusBarItem render={<Link href="/settings" />} />}
        >
          <ServerIcon aria-hidden="true" />
          {online}/{machines.length} Machines online
        </TooltipTrigger>
        <TooltipContent side="top" align="end">
          Open Machines settings
        </TooltipContent>
      </Tooltip>
    </StatusBarGroup>
  );
}

/** The window-wide bottom bar: usage at the start, Machines at the end. */
export function AppStatusBar() {
  return (
    <StatusBar>
      <DemoUsage />
      <MachinesOverview />
    </StatusBar>
  );
}
