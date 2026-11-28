"use client";

import type { ReactNode } from "react";

import { Badge } from "@workspace/ui/components/badge";

import type {
  AvailableModelResponse,
  ModelRoleCandidateResponse,
  ModelRoleResponse,
} from "@/lib/api/generated/models";
import { modelDisplayName } from "@/lib/services/models/queries";

/*
 * Each model role as the fallback chain it is: a numbered list from top to
 * bottom, the primary first, joined by a line. Failover walks it in this
 * order.
 */

function CandidateStep({
  index,
  candidate,
  models,
}: {
  index: number;
  candidate: ModelRoleCandidateResponse;
  models: ReadonlyArray<AvailableModelResponse>;
}) {
  return (
    <li className="relative">
      {/* The step number sits on the chain's line. */}
      <span
        aria-hidden
        className="absolute -left-7.5 flex size-5 items-center justify-center rounded-full border bg-background text-xs text-muted-foreground tabular-nums"
      >
        {index + 1}
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm">
          {modelDisplayName(candidate.modelId, models)}
        </span>
        <Badge variant={index === 0 ? "default" : "outline"}>
          {index === 0 ? "Primary" : "Fallback"}
        </Badge>
        {candidate.effort === undefined ? null : (
          <Badge variant="outline">effort {candidate.effort}</Badge>
        )}
        {candidate.paid ? <Badge variant="outline">Paid</Badge> : null}
      </div>
      <code className="block truncate font-mono text-xs text-muted-foreground">
        {candidate.modelId}
      </code>
    </li>
  );
}

function RoleChain({
  role,
  models,
}: {
  role: ModelRoleResponse;
  models: ReadonlyArray<AvailableModelResponse>;
}) {
  const count = role.candidates.length;

  return (
    <li className="space-y-3 py-4 first:pt-0 last:pb-0">
      <p className="flex items-baseline gap-2">
        <code className="font-mono text-sm font-medium">{role.selector}</code>
        <span className="text-xs text-muted-foreground">
          {count} {count === 1 ? "model" : "models"}
        </span>
      </p>
      <ol
        aria-label={`${role.selector} fallback order`}
        className="ml-2.5 space-y-3 border-l pl-5"
      >
        {role.candidates.map((candidate, index) => (
          <CandidateStep
            key={`${candidate.modelId}:${String(index)}`}
            index={index}
            candidate={candidate}
            models={models}
          />
        ))}
      </ol>
    </li>
  );
}

export function RoleChains({
  roles,
  models,
}: {
  roles: ReadonlyArray<ModelRoleResponse>;
  models: ReadonlyArray<AvailableModelResponse>;
}): ReactNode {
  if (roles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No roles configured.</p>
    );
  }

  return (
    <ul className="divide-y">
      {roles.map((role) => (
        <RoleChain key={role.selector} role={role} models={models} />
      ))}
    </ul>
  );
}
