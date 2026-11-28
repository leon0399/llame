"use client";

import { ChevronRightIcon, HardDriveIcon } from "lucide-react";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { Switch } from "@workspace/ui/components/switch";
import { cn } from "@workspace/ui/lib/utils";

import { SoonChip } from "@/app/shell/soon-chip";
import { RelativeTime } from "@/components/relative-time";
import { formatBytes } from "@/lib/format-bytes";
import { MACHINE_FAILURE_LABELS } from "@/lib/services/machines/labels";
import { machinePathFromRoot } from "@/lib/services/machines/locator";
import type { MachineResponse } from "@/lib/services/machines/queries";

/*
 * Machines as one list, a row each: whether it answers and since when, what
 * it is, and what it needs (an older daemon). Details (roots, protocol
 * versions) open under the row. A row is the unit a nested Machine (a recipe
 * instance on this one, #1790) will indent under, which a card grid cannot
 * show. SSH destinations, jump hosts and identities never reach this shape
 * (see `GET /api/v1/machines`), so nothing here needs redacting. Shared by
 * the owner's settings and the administration area.
 */

/** The daemon speaks an older protocol than the hub: it still connects, and
 *  updating it is the fix. */
export function machineOutdated(machine: MachineResponse): boolean {
  return (
    machine.daemonProtocolVersion !== null &&
    machine.daemonProtocolVersion < machine.hubProtocolVersion
  );
}

/** Color is never the only signal (DESIGN.md §10): the dot always travels
 *  with the word or the name. */
export function MachineStatusDot({
  status,
}: {
  status: MachineResponse["status"];
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === "online" ? "bg-success" : "bg-destructive",
      )}
    />
  );
}

/** "Online · seen 2 minutes ago", or why the last attempt failed. */
export function MachineContact({ machine }: { machine: MachineResponse }) {
  const failure = machine.failureReason;

  return (
    <>
      {machine.status === "online" ? "Online" : "Offline"}
      {failure === null ? null : (
        <span className="text-destructive">
          {" · "}
          {MACHINE_FAILURE_LABELS[failure]}
        </span>
      )}
      {" · "}
      {machine.lastSeenAt === null ? (
        "never connected"
      ) : (
        <>
          seen <RelativeTime date={machine.lastSeenAt} />
        </>
      )}
    </>
  );
}

/** What the daemon reported at its last handshake: system, processors,
 *  memory, the disks under its roots, and its version. */
export function machineFactsText(machine: MachineResponse): string | null {
  const facts = machine.facts;

  if (facts === null) return null;

  const disk = facts.rootDisks.reduce((sum, d) => sum + (d.totalBytes ?? 0), 0);

  return [
    `${facts.os} ${facts.arch}`,
    `${String(facts.cpuCount)} ${facts.cpuCount === 1 ? "CPU" : "CPUs"}`,
    `${formatBytes(facts.totalMemoryBytes)} memory`,
    disk > 0 ? `${formatBytes(disk)} disk` : null,
    machine.daemonVersion === null ? null : `daemon ${machine.daemonVersion}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/** The registered roots, each with the size of the disk that holds it. */
function Roots({ machine }: { machine: MachineResponse }) {
  if (machine.roots.length === 0) {
    return <p className="text-muted-foreground">No roots registered</p>;
  }

  const disks = new Map(
    (machine.facts?.rootDisks ?? []).map((disk) => [disk.root, disk]),
  );

  return (
    <ul className="space-y-1">
      {machine.roots.map((root) => {
        const total = disks.get(root)?.totalBytes ?? undefined;

        return (
          <li
            key={root}
            className="flex min-w-0 items-center gap-2 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground"
          >
            <HardDriveIcon aria-hidden="true" />
            <code className="min-w-0 truncate font-mono" title={root}>
              {machinePathFromRoot(root) ?? root}
            </code>
            {total === undefined ? null : (
              <span className="ml-auto shrink-0 text-muted-foreground">
                {formatBytes(total)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function versionsText(machine: MachineResponse): string {
  const hub = `hub protocol v${String(machine.hubProtocolVersion)}`;

  if (machine.daemonProtocolVersion === null) {
    return `${hub} · daemon not contacted yet`;
  }

  return `daemon protocol v${String(machine.daemonProtocolVersion)} · ${hub}`;
}

/** Roots and versions, which a reader needs only when choosing a folder or
 *  when something does not connect. */
function MachineDetails({ machine }: { machine: MachineResponse }) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={<Button variant="ghost" size="xs" />}
        className="group/details -ml-2"
      >
        <ChevronRightIcon
          aria-hidden="true"
          className="transition-transform group-data-[panel-open]/details:rotate-90"
        />
        Details
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 pt-1 pb-1 text-xs">
          <Roots machine={machine} />
          <p className="font-mono text-muted-foreground">
            {versionsText(machine)}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The owner's choice to use a shared Machine or not. Not built yet, so a
 *  visible, disabled switch (apps/web AGENTS.md); the section above the list
 *  says it is coming. */
function UseSwitch({ machine }: { machine: MachineResponse }) {
  return (
    <Switch checked disabled aria-label={`Use ${machine.name} (coming soon)`} />
  );
}

/** An older daemon: say so, and offer the update, which is not built yet. */
function OutdatedNotice() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      Runs an older daemon. It still connects; newer tools may need the update.
      <span className="flex items-center gap-2">
        <Button variant="outline" size="xs" disabled>
          Update daemon
        </Button>
        <SoonChip />
      </span>
    </div>
  );
}

function MachineRow({
  machine,
  choosable,
}: {
  machine: MachineResponse;
  choosable: boolean;
}) {
  const outdated = machineOutdated(machine);
  const facts = machineFactsText(machine);

  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className="flex h-5 items-center">
        <MachineStatusDot status={machine.status} />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-h-5 items-center gap-2">
          <h3 className="min-w-0 truncate text-sm font-medium">
            {machine.name}
          </h3>
          {outdated ? <Badge variant="outline">Outdated</Badge> : null}
          {choosable ? (
            <span className="ml-auto">
              <UseSwitch machine={machine} />
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          <MachineContact machine={machine} />
        </p>
        {facts === null ? null : (
          <p className="text-xs text-muted-foreground">{facts}</p>
        )}
        {outdated ? <OutdatedNotice /> : null}
        <MachineDetails machine={machine} />
      </div>
    </li>
  );
}

/** Every Machine in one card. `choosable` shows the owner's use switch,
 *  which the administration area has no reason to show. */
export function MachineList({
  machines,
  choosable = false,
}: {
  machines: ReadonlyArray<MachineResponse>;
  choosable?: boolean;
}) {
  return (
    <Card>
      <CardContent>
        <ul className="divide-y">
          {machines.map((machine) => (
            <MachineRow
              key={machine.name}
              machine={machine}
              choosable={choosable}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
