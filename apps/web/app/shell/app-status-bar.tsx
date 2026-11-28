"use client";

import { ArrowUpCircleIcon, GaugeIcon, ServerIcon } from "lucide-react";
import Link from "next/link";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card";
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

import { DemoChip } from "@/app/shell/soon-chip";
import {
  MachineContact,
  MachineResources,
  MachineStatusDot,
  machineOutdated,
} from "@/components/machines/machine-list";
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

/** A Machine at a glance; hovering or focusing it shows the rest of its row
 *  from the Machines page, and it opens that page. */
function MachineItem({ machine }: { machine: MachineResponse }) {
  return (
    <HoverCard>
      <HoverCardTrigger
        render={<StatusBarItem render={<Link href="/settings/machines" />} />}
      >
        <MachineStatusDot status={machine.status} />
        {/* Names run to 63 characters; three of them must not crowd out
            the online count. */}
        <span className="max-w-32 truncate">{machine.name}</span>
        {/* The dot is decorative; the state is text a screen reader reads. */}
        <span className="sr-only">, {machine.status}</span>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-72">
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              <MachineStatusDot status={machine.status} />
              <span className="min-w-0 truncate">{machine.name}</span>
              {machineOutdated(machine) ? (
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  Older daemon
                </span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">
              <MachineContact machine={machine} />
            </p>
          </div>
          <MachineResources machine={machine} />
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

/** Daemons older than the hub, named once in the bar so an update is not
 *  found only by opening the Machines page. */
function OutdatedItem({ machines }: { machines: Array<MachineResponse> }) {
  const outdated = machines.filter(machineOutdated);

  if (outdated.length === 0) return null;

  return (
    <StatusBarItem render={<Link href="/settings/machines" />}>
      <ArrowUpCircleIcon aria-hidden="true" />
      {outdated.length === 1
        ? `${outdated[0]!.name} runs an older daemon`
        : `${String(outdated.length)} Machines run an older daemon`}
    </StatusBarItem>
  );
}

/**
 * The configured Machines at a glance: any that need a daemon update, the
 * first few by name with their state, and how many are online. Kept current
 * by live updates; nothing is shown on an instance without Machines.
 */
function MachinesOverview() {
  const { data: machines } = useMachinesQuery();

  if (machines === undefined || machines.length === 0) return null;

  const online = machines.filter((m) => m.status === "online").length;

  return (
    <StatusBarGroup>
      <OutdatedItem machines={machines} />
      {machines.slice(0, NAMED_MACHINES).map((machine) => (
        <MachineItem key={machine.name} machine={machine} />
      ))}
      <Tooltip>
        <TooltipTrigger
          render={<StatusBarItem render={<Link href="/settings/machines" />} />}
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
