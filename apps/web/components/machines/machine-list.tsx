"use client";

import {
  ArrowUpCircleIcon,
  ChevronRightIcon,
  HardDriveIcon,
} from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { Switch } from "@workspace/ui/components/switch";
import { cn } from "@workspace/ui/lib/utils";

import { RelativeTime } from "@/components/relative-time";
import { formatBytes } from "@/lib/format-bytes";
import { MACHINE_FAILURE_LABELS } from "@/lib/services/machines/labels";
import { machinePathFromRoot } from "@/lib/services/machines/locator";
import type { MachineResponse } from "@/lib/services/machines/queries";

/*
 * Machines as one list, a row each: whether it answers and since when, what
 * it is, and what it needs (an older daemon). Details (roots, protocol
 * versions) open under the row. A row is the unit a nested Machine (a recipe
 * instance on this one) will indent under, which a card grid cannot show.
 * TODO(#1790): nest a Machine's recipe instances under its row. SSH
 * destinations, jump hosts and identities never reach this shape (see
 * `GET /api/v1/machines`), so nothing here needs redacting. Shared by the
 * owner's settings and the administration area.
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

/** Live load, as fractions of capacity (0–1).
 *  TODO(#1992): the daemon reports totals only and nothing sends live use
 *  yet, so every meter reads "—"; pass the reading once Machines report it. */
export type MachineLoad = { cpu: number; memory: number; disk: number };

/** One resource: its name and use, a track that fills with it, and the
 *  capacity under it. Without a reading the track stays empty. */
function ResourceMeter({
  label,
  fraction,
  capacity,
}: {
  label: string;
  fraction: number | undefined;
  capacity: string | null;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="flex justify-between gap-2 text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {fraction === undefined
            ? "—"
            : `${String(Math.round(fraction * 100))}%`}
        </span>
      </p>
      {fraction === undefined ? (
        <span className="block h-1.5 rounded-full bg-muted" />
      ) : (
        <meter
          value={fraction}
          aria-label={`${label} in use`}
          className="block h-1.5 w-full appearance-none overflow-hidden rounded-full [&::-moz-meter-bar]:bg-foreground [&::-webkit-meter-bar]:bg-muted [&::-webkit-meter-optimum-value]:bg-foreground"
        />
      )}
      <p className="truncate text-xs text-muted-foreground">
        {capacity ?? "Unknown"}
      </p>
    </div>
  );
}

/** The disk the roots live on. Each root reports the size of the filesystem
 *  that holds it, and roots can share one, so the sizes are never added: one
 *  size is shown as is, and differing sizes as the largest. */
function diskCapacity(
  rootDisks: ReadonlyArray<{ totalBytes: number | null }>,
): string | null {
  const sizes = new Set(
    rootDisks.flatMap((disk) =>
      disk.totalBytes === null || disk.totalBytes === 0
        ? []
        : [disk.totalBytes],
    ),
  );

  if (sizes.size === 0) return null;

  const largest = formatBytes(Math.max(...sizes));

  return sizes.size === 1 ? largest : `largest ${largest}`;
}

/** Processors, memory and the disks under the roots, each with how much is
 *  in use once the daemon reports it. */
export function MachineResources({
  machine,
  load,
}: {
  machine: MachineResponse;
  load?: MachineLoad;
}) {
  const facts = machine.facts;

  return (
    <div className="grid grid-cols-3 gap-4">
      <ResourceMeter
        label="CPU"
        fraction={load?.cpu}
        capacity={
          facts === null
            ? null
            : `${String(facts.cpuCount)} ${facts.cpuCount === 1 ? "core" : "cores"}`
        }
      />
      <ResourceMeter
        label="Memory"
        fraction={load?.memory}
        capacity={facts === null ? null : formatBytes(facts.totalMemoryBytes)}
      />
      <ResourceMeter
        label="Disk"
        fraction={load?.disk}
        capacity={diskCapacity(facts?.rootDisks ?? [])}
      />
    </div>
  );
}

/** "daemon 0.6.1, outdated" in the row's meta line: the version every row
 *  shows, and the one word that differs when the hub is newer. */
function DaemonVersion({ machine }: { machine: MachineResponse }) {
  if (machine.daemonVersion === null) return null;

  return (
    <>
      {" · daemon "}
      {machine.daemonVersion}
      {machineOutdated(machine) ? (
        <span className="text-foreground">, outdated</span>
      ) : null}
    </>
  );
}

/** The row's actions at its end: Update for an older daemon, then the use
 *  switch. Neither is built yet, so both are visible and disabled (apps/web
 *  AGENTS.md); the section above the list says they are coming.
 *  TODO(#1815): updating a daemon from llame. TODO(#1993): an owner turning
 *  a shared Machine off for themselves. */
function MachineActions({
  machine,
  choosable,
}: {
  machine: MachineResponse;
  choosable: boolean;
}) {
  return (
    <span className="flex h-6 shrink-0 items-center gap-3">
      {machineOutdated(machine) ? (
        <Button variant="outline" size="xs" disabled>
          <ArrowUpCircleIcon aria-hidden="true" />
          Update
        </Button>
      ) : null}
      {choosable ? (
        <Switch
          checked
          disabled
          aria-label={`Use ${machine.name} (coming soon)`}
        />
      ) : null}
    </span>
  );
}

function MachineHeader({
  machine,
  choosable,
}: {
  machine: MachineResponse;
  choosable: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="flex min-h-6 min-w-0 flex-1 items-center gap-2 text-sm font-medium">
        <MachineStatusDot status={machine.status} />
        <span className="truncate">{machine.name}</span>
      </h3>
      <MachineActions machine={machine} choosable={choosable} />
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
  return (
    <li className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="space-y-1">
        <MachineHeader machine={machine} choosable={choosable} />
        <p className="text-xs text-muted-foreground">
          <MachineContact machine={machine} />
          {machine.facts === null
            ? null
            : ` · ${machine.facts.os} ${machine.facts.arch}`}
          <DaemonVersion machine={machine} />
        </p>
      </div>
      <MachineResources machine={machine} />
      <MachineDetails machine={machine} />
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
