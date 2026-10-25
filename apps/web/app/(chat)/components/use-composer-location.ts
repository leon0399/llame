"use client";

import { useState } from "react";

import type {
  CheckoutResponse,
  MachineResponse,
} from "@/lib/api/generated/models";
import { useCheckoutsQuery } from "@/lib/services/checkouts/queries";
import { useMachinesQuery } from "@/lib/services/machines/queries";
import { useProjectRepositoryLinksQuery } from "@/lib/services/project/queries";
import {
  executorLabel,
  executorOptions,
  resolveLocation,
  unavailableExecutor,
  useStartLocationPreview,
  type ExecutorOption,
  type ResolvedLocation,
  type StartLocationIsolation,
  type StartLocationResponse,
  type StartLocationSelection,
  type WorkspaceFailure,
} from "@/lib/services/project/start-location";
import type { StartLocationPrefill } from "@/lib/services/project/start-location-link";
import type { ProjectRepositoryLink } from "@/lib/services/project/types";

/** One registered `main` checkout the composer can start a chat in. */
export type WorkingDirectoryOption = {
  checkoutId: string;
  path: string;
  /** The Machine (or local executor) that holds it. */
  machine: string;
  /** The project links its repository, so it is offered first. */
  linked: boolean;
};

/** The selection the composer holds; `undefined` means "let the server
 *  resolve it", which is what the common case sends. */
type SelectionDraft = StartLocationSelection & {
  /** The reader removed the working directory: the chat starts unbound. */
  cleared: boolean;
  isolation: StartLocationIsolation | null;
};

/** The levels the pill renders. */
type ComposerLocationView = {
  workingDirectories: Array<WorkingDirectoryOption>;
  machineOptions: Array<ExecutorOption>;
  location: ResolvedLocation;
  /** The reader's choice, else the preview's default. */
  isolation: StartLocationIsolation;
};

type ComposerLocationActions = {
  selectWorkingDirectory: (checkout: CheckoutResponse) => void;
  clearWorkingDirectory: () => void;
  selectIsolation: (isolation: StartLocationIsolation) => void;
};

/** Everything the location row reads; the hook is its only producer. */
export type ComposerLocation = ComposerLocationView &
  ComposerLocationActions & {
    /** The owner's checkouts, for matching a typed path to a registered one. */
    checkouts: ReadonlyArray<CheckoutResponse>;
    preview: { failed: boolean; refetch: () => void };
  };

type PreviewState = {
  data: StartLocationResponse | undefined;
  isPending: boolean;
  isError: boolean;
};

type DeriveLocationViewInput = {
  draft: SelectionDraft;
  preview: PreviewState;
  links: ReadonlyArray<ProjectRepositoryLink>;
  checkouts: ReadonlyArray<CheckoutResponse>;
  machines: ReadonlyArray<MachineResponse> | undefined;
  failed: WorkspaceFailure | null;
};

/** Every registered `main` checkout, the project's own repositories first. */
function workingDirectoriesOf(
  input: DeriveLocationViewInput,
): Array<WorkingDirectoryOption> {
  const linked = new Set(input.links.map((link) => link.repositoryId));
  return input.checkouts
    .filter((checkout) => checkout.kind === "main")
    .map((checkout) => ({
      checkoutId: checkout.id,
      path: checkout.path,
      machine: executorLabel(checkout.executorId, input.machines),
      linked: linked.has(checkout.repositoryId),
    }))
    .sort(
      (left, right) =>
        Number(right.linked) - Number(left.linked) ||
        left.machine.localeCompare(right.machine) ||
        left.path.localeCompare(right.path),
    );
}

/** The whole view, from the reads the hook performs; pure so it is unit-tested
 *  without a renderer (the resolved-location module owns the rules). */
function deriveLocationView(
  input: DeriveLocationViewInput,
): ComposerLocationView {
  const { draft, preview } = input;
  const location = resolveLocation({
    preview: preview.data,
    previewFailed: preview.isError,
    checkouts: input.checkouts,
    machines: input.machines,
    failed: input.failed,
  });
  return {
    workingDirectories: workingDirectoriesOf(input),
    machineOptions: executorOptions({
      repositoryId: location.repositoryId,
      checkouts: input.checkouts,
      machines: input.machines,
      unavailable: unavailableExecutor(input.failed),
    }),
    location,
    isolation: draft.isolation ?? location.isolation,
  };
}

/**
 * The location a create without a project would use. No project means no
 * links and no policy, so the named checkout (or a repository's only `main`
 * checkout on the named Machine) is the whole answer, and isolation follows
 * the reader.
 */
function localPreview(
  draft: SelectionDraft,
  checkouts: ReadonlyArray<CheckoutResponse>,
): StartLocationResponse {
  const mains = checkouts.filter(
    (row) =>
      row.kind === "main" &&
      row.repositoryId === draft.repositoryId &&
      row.executorId === draft.executorId,
  );
  const row = draft.cleared
    ? undefined
    : draft.checkoutId === undefined
      ? mains.length === 1
        ? mains[0]
        : undefined
      : checkouts.find((checkout) => checkout.id === draft.checkoutId);
  return {
    projectId: "",
    repositoryId: row?.repositoryId ?? null,
    executorId: row?.executorId ?? null,
    checkoutId: row?.id ?? null,
    isolation: "reuse",
    isolationReason: "no_link",
    isolationChats: 0,
  };
}

/**
 * The composer's selection state. Any choice clears the isolation override so
 * the new default applies (design D10). `initial` is the entry point's
 * pre-fill, read once. A project change keeps the draft: the project and the
 * working directory are separate settings.
 */
function initialDraft(
  initial: StartLocationPrefill | null | undefined,
): SelectionDraft {
  return {
    ...initial?.selection,
    cleared: false,
    isolation: initial?.isolation ?? null,
  };
}

type DraftUpdate = (
  change: (current: SelectionDraft) => SelectionDraft,
) => void;

/** The level setters over one draft update. */
function draftActions(update: DraftUpdate): ComposerLocationActions {
  return {
    selectWorkingDirectory: (checkout: CheckoutResponse) =>
      update((current) => ({
        ...current,
        repositoryId: checkout.repositoryId,
        executorId: checkout.executorId,
        checkoutId: checkout.id,
        cleared: false,
        isolation: null,
      })),
    clearWorkingDirectory: () =>
      update((current) => ({
        ...current,
        repositoryId: undefined,
        executorId: undefined,
        checkoutId: undefined,
        cleared: true,
        isolation: null,
      })),
    selectIsolation: (isolation: StartLocationIsolation) =>
      update((current) => ({ ...current, isolation })),
  };
}

function useSelectionDraft(
  initial: StartLocationPrefill | null | undefined,
  onChange?: () => void,
): ComposerLocationActions & { draft: SelectionDraft } {
  const [draft, setDraft] = useState(() => initialDraft(initial));
  const actions = draftActions((change) => {
    setDraft(change);
    onChange?.();
  });
  return { draft, ...actions };
}

type ComposerLocationArgs = {
  /** The project whose links and preview are read; null resolves locally. */
  projectId: string | null;
  /** The create's Workspace failure, shown on the pill until the draft moves. */
  failed: WorkspaceFailure | null;
  /** Any change to the selection means the reader is correcting the draft. */
  onChange?: () => void;
  /** The entry point's pre-fill: a deep link, or "New chat here". */
  initial?: StartLocationPrefill | null;
  /** False for a chat that already exists: it reads nothing. */
  enabled?: boolean;
};

/**
 * Where the location comes from: a project's preview route, which runs the
 * create's own resolver, or the chosen checkout resolved locally when there
 * is no project. A removed working directory resolves to nothing either way.
 */
function useLocationPreview(
  projectId: string | null,
  draft: SelectionDraft,
  checkouts: ReadonlyArray<CheckoutResponse>,
  enabled: boolean,
): PreviewState & { refetch: () => void } {
  const served = enabled && projectId !== null && !draft.cleared;
  const remote = useStartLocationPreview(projectId ?? "", draft, served);
  const refetch = () => {
    void remote.refetch();
  };
  if (served) return { ...remote, refetch };
  return {
    data: localPreview(draft, checkouts),
    isPending: false,
    isError: false,
    refetch,
  };
}

/** The working-directory pill's one source of truth (design D10). */
export function useComposerLocation({
  projectId,
  failed,
  onChange,
  initial,
  enabled = true,
}: ComposerLocationArgs): ComposerLocation {
  const { draft, ...actions } = useSelectionDraft(initial, onChange);
  const links = useProjectRepositoryLinksQuery(
    projectId ?? "",
    enabled && projectId !== null,
  );
  const checkouts = useCheckoutsQuery(undefined, enabled).data ?? [];
  const machines = useMachinesQuery(enabled);
  const preview = useLocationPreview(projectId, draft, checkouts, enabled);
  return {
    ...deriveLocationView({
      draft,
      preview,
      links: links.data ?? [],
      checkouts,
      machines: machines.data,
      failed,
    }),
    ...actions,
    checkouts,
    preview: { failed: preview.isError, refetch: preview.refetch },
  };
}
