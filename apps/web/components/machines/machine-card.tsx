"use client";

import type { ReactNode } from "react";
import { HardDriveIcon, ServerIcon } from "lucide-react";

import { Card, CardContent } from "@workspace/ui/components/card";
import { cn } from "@workspace/ui/lib/utils";

import { RelativeTime } from "@/components/relative-time";
import { formatBytes } from "@/lib/format-bytes";
import { MACHINE_FAILURE_LABELS } from "@/lib/services/machines/labels";
import type { MachineResponse } from "@/lib/services/machines/queries";
import { machinePathFromRoot } from "@/lib/services/machines/locator";

/*
 * One Machine as a card: who it is and whether it answers, then what it is
 * (system facts) and what it offers (roots and the size of their disks),
 * then the versions a reader needs only when something does not connect.
 * SSH destinations, jump hosts and identities never reach this shape (see
 * `GET /api/v1/machines`), so nothing here needs redacting. Shared by the
 * owner's settings and the administration area.
 */

/** "● Online" / "● Offline", always with the word: color is never the only
 *  signal (DESIGN.md §10). */
function MachineStatus({ online }: { online: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          online ? "bg-success" : "bg-destructive",
        )}
      />
      {online ? "Online" : "Offline"}
    </span>
  );
}

/** Last contact, and the reason the last attempt failed when one did. */
function ContactLine({ machine }: { machine: MachineResponse }) {
  const failure = machine.failureReason;

  return (
    <p className="text-sm text-muted-foreground">
      {failure === null ? null : (
        <span className="text-destructive">
          {MACHINE_FAILURE_LABELS[failure]} ·{" "}
        </span>
      )}
      {machine.lastSeenAt === null ? (
        "Never connected"
      ) : (
        <>
          Seen <RelativeTime date={machine.lastSeenAt} />
        </>
      )}
    </p>
  );
}

function FactChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

/** What the daemon reported at its last handshake; nothing before one. */
function SystemFacts({ facts }: { facts: MachineResponse["facts"] }) {
  if (facts === null) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      <FactChip>
        {facts.os} · {facts.arch}
      </FactChip>
      <FactChip>
        {facts.cpuCount} {facts.cpuCount === 1 ? "CPU" : "CPUs"}
      </FactChip>
      <FactChip>{formatBytes(facts.totalMemoryBytes)} memory</FactChip>
    </div>
  );
}

/** The registered roots, each with the size of the disk that holds it. */
function Roots({ machine }: { machine: MachineResponse }) {
  if (machine.roots.length === 0) {
    return <p className="text-sm text-muted-foreground">No roots registered</p>;
  }

  const disks = new Map(
    (machine.facts?.rootDisks ?? []).map((disk) => [disk.root, disk]),
  );

  return (
    <ul className="space-y-1.5">
      {machine.roots.map((root) => {
        const total = disks.get(root)?.totalBytes ?? null;

        return (
          <li
            key={root}
            className="flex min-w-0 items-center gap-2 text-sm [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground"
          >
            <HardDriveIcon aria-hidden="true" />
            <code className="min-w-0 truncate font-mono text-xs" title={root}>
              {machinePathFromRoot(root) ?? root}
            </code>
            {total === null ? null : (
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {formatBytes(total)} disk
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Both protocol versions the hub and the daemon agreed on. */
function versionsText(machine: MachineResponse): string {
  const hub = `hub protocol v${String(machine.hubProtocolVersion)}`;

  if (machine.daemonVersion === null)
    return `${hub} · daemon not contacted yet`;

  return `daemon ${machine.daemonVersion} · protocol v${String(machine.daemonProtocolVersion)} · ${hub}`;
}

export function MachineCard({ machine }: { machine: MachineResponse }) {
  return (
    <Card>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 [&>svg]:size-4 [&>svg]:shrink-0">
              <ServerIcon aria-hidden="true" />
              <h3 className="min-w-0 truncate text-sm font-semibold">
                {machine.name}
              </h3>
              <span className="ml-auto">
                <MachineStatus online={machine.status === "online"} />
              </span>
            </div>
            <ContactLine machine={machine} />
          </div>
          <SystemFacts facts={machine.facts} />
          <Roots machine={machine} />
          <p className="border-t pt-3 font-mono text-xs text-muted-foreground">
            {versionsText(machine)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** The cards in a responsive grid: one column on a phone, two from `lg`. */
export function MachineCardGrid({
  machines,
}: {
  machines: ReadonlyArray<MachineResponse>;
}) {
  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {machines.map((machine) => (
        <li key={machine.name} className="min-w-0">
          <MachineCard machine={machine} />
        </li>
      ))}
    </ul>
  );
}
