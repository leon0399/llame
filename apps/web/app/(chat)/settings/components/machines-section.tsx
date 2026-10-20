"use client";

import type { ReactNode } from "react";

import { Alert, AlertAction, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { cn } from "@workspace/ui/lib/utils";

import { RelativeTime } from "@/components/relative-time";
import type { MachineResponse } from "@/lib/services/machines/queries";
import { useMachinesQuery } from "@/lib/services/machines/queries";

/**
 * The five failure reasons the hub records, in the words a reader needs rather
 * than the wire's identifiers. `Record` over the generated union keeps a new
 * reason from compiling without a label.
 */
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

function MachineRoots({ roots }: { roots: ReadonlyArray<string> }) {
  if (roots.length === 0) {
    return <span className="text-muted-foreground">No roots registered</span>;
  }

  return (
    <ul className="space-y-1">
      {roots.map((root) => (
        <li key={root}>
          <code className="font-mono text-xs break-all">{root}</code>
        </li>
      ))}
    </ul>
  );
}

/** Both protocol versions the hub and the daemon agreed on, or why there is
 *  no daemon version yet. */
function versionsText(machine: MachineResponse): string {
  if (machine.daemonVersion === null) {
    return `Hub protocol v${String(machine.hubProtocolVersion)} · daemon not contacted yet`;
  }
  return `Hub protocol v${String(machine.hubProtocolVersion)} · daemon ${machine.daemonVersion} (protocol v${String(machine.daemonProtocolVersion)})`;
}

function FactRow({
  label,
  valueClassName,
  children,
}: {
  label: string;
  valueClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={valueClassName}>{children}</dd>
    </div>
  );
}

/** The Machine's name and derived state, the two facts the reader scans for. */
function MachineHeader({ machine }: { machine: MachineResponse }) {
  const online = machine.status === "online";

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            online ? "bg-success" : "bg-destructive",
          )}
        />
        <span className="truncate text-sm font-medium">{machine.name}</span>
      </span>
      <span className="shrink-0 text-sm text-muted-foreground">
        {online ? "Online" : "Offline"}
      </span>
    </div>
  );
}

function MachineFacts({ machine }: { machine: MachineResponse }) {
  const failure = machine.failureReason;

  return (
    <dl className="space-y-1 text-sm">
      <FactRow label="Last seen">
        {machine.lastSeenAt === null ? (
          "Never connected"
        ) : (
          <RelativeTime date={machine.lastSeenAt} />
        )}
      </FactRow>
      {failure === null ? null : (
        <FactRow label="Last failure" valueClassName="text-destructive">
          {FAILURE_LABELS[failure]}
        </FactRow>
      )}
      <FactRow label="Versions">{versionsText(machine)}</FactRow>
      <FactRow label="Roots">
        <MachineRoots roots={machine.roots} />
      </FactRow>
    </dl>
  );
}

/**
 * One Machine's row: name and state first, then the facts the spec makes
 * visible — last contact, the last failure, both protocol versions, and the
 * registered roots. SSH destinations, jump hosts, and identities never reach
 * this shape (see `GET /api/v1/machines`), so nothing here needs redacting.
 */
function MachineDetails({ machine }: { machine: MachineResponse }) {
  return (
    <li className="space-y-3">
      <MachineHeader machine={machine} />
      <MachineFacts machine={machine} />
    </li>
  );
}

function MachinesLoadErrorAlert({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Could not load Machines.</AlertTitle>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}

/**
 * Read-only Machines list. An instance whose operator configured no Machines
 * has no such route at all — `fetchMachines` turns that 404 (and an empty
 * list) into the same hidden state, so the settings page never offers a
 * surface that does not exist. A pending read is hidden for the same reason:
 * flashing a card in and back out is worse than arriving with the data.
 *
 * @summary read-only Machines status, hidden when none are configured
 */
export function MachinesSection() {
  const { data, isPending, isError, refetch } = useMachinesQuery();

  if (isPending) return null;
  if (isError) {
    return <MachinesLoadErrorAlert onRetry={() => void refetch()} />;
  }
  if (data === undefined || data.length === 0) return null;

  return (
    <Card className="lg:max-w-2xl">
      <CardHeader>
        <CardTitle>Machines</CardTitle>
        <CardDescription>
          Remote hosts this instance can run tools on. The operator configures
          them; this list is read-only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-6">
          {data.map((machine) => (
            <MachineDetails key={machine.name} machine={machine} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
