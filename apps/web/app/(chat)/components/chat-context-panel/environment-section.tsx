"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { CheckIcon, CopyIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";

import { copyText } from "@/lib/clipboard";
import type { MachineResponse } from "@/lib/services/machines/queries";

const FAILURE_LABELS: Record<
  NonNullable<MachineResponse["failureReason"]>,
  string
> = {
  unreachable: "could not be reached",
  host_key_mismatch: "host key does not match",
  auth_failed: "authentication failed",
  incompatible_version: "incompatible protocol version",
  session_lost: "connection lost",
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

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function ProjectValue({
  project,
}: {
  project: EnvironmentProject | null | undefined;
}) {
  if (project === undefined) return <span aria-busy="true">…</span>;
  if (project === null) {
    return <span className="text-muted-foreground">None</span>;
  }
  return (
    <Link href={`/projects/${project.id}`} prefetch={false}>
      {project.name}
    </Link>
  );
}

function machineDetail(machine: MachineResponse): string {
  if (machine.status === "offline") {
    return machine.failureReason === null
      ? "Offline"
      : `Offline · ${FAILURE_LABELS[machine.failureReason]}`;
  }
  if (machine.lastSeenAt === null) return "Online";
  const ago = formatDistanceToNowStrict(new Date(machine.lastSeenAt), {
    addSuffix: true,
  });
  return `Online · seen ${ago}`;
}

/** Where the Chat's tools run: this host, or a Machine and its state. */
function LocationValue({
  workspaceRoot,
  machineName,
  machine,
}: Pick<EnvironmentSectionProps, "workspaceRoot" | "machineName" | "machine">) {
  if (workspaceRoot === null) {
    return <span className="text-muted-foreground">No Workspace</span>;
  }
  if (machineName === undefined) return <span>This host</span>;

  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            machine === undefined
              ? "bg-muted-foreground"
              : machine.status === "online"
                ? "bg-foreground"
                : "bg-destructive",
          )}
        />
        <span className="truncate font-medium">{machineName}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {machine === undefined ? "Status unknown" : machineDetail(machine)}
      </span>
    </span>
  );
}

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (await copyText(path)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Copy Workspace path"
        onClick={() => void copy()}
      >
        {copied ? (
          <CheckIcon aria-hidden="true" />
        ) : (
          <CopyIcon aria-hidden="true" />
        )}
      </Button>
      <output className="sr-only">{copied ? "Copied" : ""}</output>
    </>
  );
}

/**
 * The Chat's environment: its Project, where its tools run, and the Workspace
 * root, shown in full and copyable. The root is the canonical locator the
 * tools use, so a copied `machine://` value pastes straight back into a
 * prompt.
 */
export function EnvironmentSection({
  workspaceRoot,
  machineName,
  machine,
  project,
}: EnvironmentSectionProps) {
  return (
    <section aria-labelledby="chat-environment-heading" className="space-y-3">
      <h2 id="chat-environment-heading" className="text-sm font-semibold">
        Environment
      </h2>
      <dl className="space-y-3">
        <Fact label="Project">
          <ProjectValue project={project} />
        </Fact>
        <Fact label="Runs on">
          <LocationValue
            workspaceRoot={workspaceRoot}
            machineName={machineName}
            machine={machine}
          />
        </Fact>
        {workspaceRoot === null ? null : (
          <Fact label="Workspace">
            <span className="flex items-start gap-1">
              <code className="min-w-0 flex-1 font-mono text-xs break-all">
                {workspaceRoot}
              </code>
              <CopyPathButton path={workspaceRoot} />
            </span>
          </Fact>
        )}
      </dl>
    </section>
  );
}
