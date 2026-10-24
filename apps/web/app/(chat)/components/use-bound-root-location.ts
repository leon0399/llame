"use client";

import type { ChatResponse } from "@/lib/services/chat/queries";
import { useCheckoutsQuery } from "@/lib/services/checkouts/queries";
import { useMachinesQuery } from "@/lib/services/machines/queries";
import {
  useProjectById,
  useProjectRepositoryLinksQuery,
} from "@/lib/services/project/queries";
import {
  boundRootChip,
  type BoundRootChipSummary,
} from "@/lib/services/project/start-location";
import { useRepositoriesQuery } from "@/lib/services/repositories/queries";

/** The chat fields the read-only chip resolves. */
export type BoundRootChat = Pick<ChatResponse, "projectId" | "workspaceRoot">;

/**
 * The chat header's read-only location (design D10). It starts from the chat's
 * own `workspaceRoot` and reads the owner's catalog only to name what that root
 * is — its repository alias and its Machine — so the header can never show a
 * location the chat is not actually bound to. A chat bound to nothing reads
 * the empty selection and fetches nothing.
 */
export function useBoundRootLocation(
  chat: BoundRootChat,
): BoundRootChipSummary {
  const projectId = chat.projectId;
  const bound = chat.workspaceRoot !== null;
  const { project } = useProjectById(
    projectId ?? undefined,
    projectId !== null,
  );
  const links = useProjectRepositoryLinksQuery(
    projectId ?? "",
    projectId !== null,
  );
  const repositories = useRepositoriesQuery(bound);
  const checkouts = useCheckoutsQuery(undefined, bound);
  const machines = useMachinesQuery(bound);
  return boundRootChip({
    projectName: project?.name ?? null,
    workspaceRoot: chat.workspaceRoot,
    links: links.data ?? [],
    repositories: repositories.data ?? [],
    checkouts: checkouts.data ?? [],
    machines: machines.data,
  });
}
