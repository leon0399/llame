"use client";

import { useState } from "react";

import type {
  CheckoutResponse,
  MachineResponse,
} from "@/lib/api/generated/models";
import { useCheckoutsQuery } from "@/lib/services/checkouts/queries";
import { useMachinesQuery } from "@/lib/services/machines/queries";
import { useProjectRepositoryLinksQuery } from "@/lib/services/project/queries";
import { useRepositoriesQuery } from "@/lib/services/repositories/queries";
import {
  checkoutOptions,
  executorOptions,
  isolationReasonLabel,
  locationChip,
  resolveLocation,
  unavailableExecutor,
  useStartLocationPreview,
  type CheckoutOption,
  type ExecutorOption,
  type LocationChipSummary,
  type ResolvedLocation,
  type StartLocationIsolation,
  type StartLocationResponse,
  type StartLocationSelection,
  type WorkspaceFailure,
} from "@/lib/services/project/start-location";
import type { StartLocationPrefill } from "@/lib/services/project/start-location-link";
import type { ProjectRepositoryLink } from "@/lib/services/project/types";
import type { RepositoryResponse } from "@/lib/services/repositories/queries";

/** One repository link as the cascade's repository level offers it. */
export type RepositoryOption = {
  id: string;
  label: string;
  isPrimary: boolean;
};

/** The selection the composer holds; `undefined`/`null` means "let the server
 *  resolve it", which is what the common case sends. */
type SelectionDraft = StartLocationSelection & {
  isolation: StartLocationIsolation | null;
  worktreeName: string;
  baseRef: string;
};

/** The levels and the labels the chip and the cascade render. */
type ComposerLocationView = {
  projectName: string;
  /** The repository level's choices; the popover renders above one link only. */
  repositoryOptions: Array<RepositoryOption>;
  machineOptions: Array<ExecutorOption>;
  checkoutChoices: Array<CheckoutOption>;
  location: ResolvedLocation;
  chip: LocationChipSummary;
  isolation: StartLocationIsolation;
  isolationLabel: string;
  followsDefault: boolean;
  worktreeName: string;
  baseRef: string;
};

type ComposerLocationActions = {
  selectRepository: (repositoryId: string) => void;
  selectExecutor: (executorId: string) => void;
  selectCheckout: (checkoutId: string) => void;
  selectIsolation: (isolation: StartLocationIsolation) => void;
  setWorktreeName: (name: string) => void;
  setBaseRef: (baseRef: string) => void;
};

/** Everything the chip and the cascade read; the hook is its only producer. */
export type ComposerLocation = ComposerLocationView &
  ComposerLocationActions & {
    selection: StartLocationSelection;
    preview: { pending: boolean; failed: boolean; refetch: () => void };
  };

type PreviewState = {
  data: StartLocationResponse | undefined;
  isPending: boolean;
  isError: boolean;
};

type DeriveLocationViewInput = {
  projectName: string;
  draft: SelectionDraft;
  preview: PreviewState;
  links: ReadonlyArray<ProjectRepositoryLink>;
  repositories: ReadonlyArray<RepositoryResponse>;
  checkouts: ReadonlyArray<CheckoutResponse>;
  machines: ReadonlyArray<MachineResponse> | undefined;
  failed: WorkspaceFailure | null;
};

/**
 * The effective isolation: the reader's override, else the preview's default;
 * the label names the preview's reason only while the value still follows it.
 */
function isolationView(
  draft: SelectionDraft,
  location: ResolvedLocation,
): Pick<
  ComposerLocationView,
  "isolation" | "isolationLabel" | "followsDefault"
> {
  const isolation = draft.isolation ?? location.isolation;
  const followsDefault =
    draft.isolation === null || draft.isolation === location.isolation;
  return {
    isolation,
    followsDefault,
    isolationLabel: isolationReasonLabel(
      isolation,
      location.isolationReason,
      location.isolationChats,
      followsDefault,
    ),
  };
}

function repositoryOptionsOf(
  links: ReadonlyArray<ProjectRepositoryLink>,
): Array<RepositoryOption> {
  return links.map((link) => ({
    id: link.repositoryId,
    label: link.alias,
    isPrimary: link.isPrimary,
  }));
}

/** The machine and checkout levels of the resolved repository. */
function locationChoices(
  location: ResolvedLocation,
  input: DeriveLocationViewInput,
): Pick<ComposerLocationView, "machineOptions" | "checkoutChoices"> {
  return {
    machineOptions: executorOptions({
      repositoryId: location.repositoryId,
      checkouts: input.checkouts,
      machines: input.machines,
      unavailable: unavailableExecutor(input.failed),
    }),
    checkoutChoices: checkoutOptions(
      location.repositoryId,
      location.executor?.executorId ?? null,
      input.checkouts,
    ),
  };
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
    pending: preview.isPending,
    links: input.links,
    repositories: input.repositories,
    checkouts: input.checkouts,
    machines: input.machines,
    failed: input.failed,
  });
  const isolation = isolationView(draft, location);
  return {
    projectName: input.projectName,
    repositoryOptions: repositoryOptionsOf(input.links),
    ...locationChoices(location, input),
    location,
    ...isolation,
    chip: locationChip({
      projectName: input.projectName,
      location,
      isolation: isolation.isolation,
      worktreeName: draft.worktreeName,
      baseRef: draft.baseRef,
      pending: preview.isPending,
      followsDefault: isolation.followsDefault,
      isolationLabel: isolation.isolationLabel,
    }),
    worktreeName: draft.worktreeName,
    baseRef: draft.baseRef,
  };
}

/**
 * The composer's selection state and its level setters. Every level recomputes
 * the levels below it from their defaults: a repository or machine choice
 * drops the checkout, and any level clears the isolation override so the new
 * preview default applies (design D10). `onChange` lets the composer clear a
 * failed create's warning, because the draft is being corrected. `initial` is
 * the entry point's pre-fill (a deep link or "New chat here"), read once.
 */
function initialDraft(
  initial: StartLocationPrefill | null | undefined,
): SelectionDraft {
  return {
    ...initial?.selection,
    isolation: initial?.isolation ?? null,
    worktreeName: "",
    baseRef: "",
  };
}

function useSelectionDraft(
  initial: StartLocationPrefill | null | undefined,
  onChange?: () => void,
): ComposerLocationActions & { draft: SelectionDraft } {
  const [draft, setDraft] = useState<SelectionDraft>(() =>
    initialDraft(initial),
  );
  const update = (change: (current: SelectionDraft) => SelectionDraft) => {
    setDraft(change);
    onChange?.();
  };
  return {
    draft,
    selectRepository: (repositoryId: string) =>
      update((current) => ({
        ...current,
        repositoryId,
        executorId: undefined,
        checkoutId: undefined,
        isolation: null,
      })),
    selectExecutor: (executorId: string) =>
      update((current) => ({
        ...current,
        executorId,
        checkoutId: undefined,
        isolation: null,
      })),
    selectCheckout: (checkoutId: string) =>
      update((current) => ({ ...current, checkoutId, isolation: null })),
    selectIsolation: (isolation: StartLocationIsolation) =>
      update((current) => ({ ...current, isolation })),
    setWorktreeName: (worktreeName: string) =>
      update((current) => ({ ...current, worktreeName })),
    setBaseRef: (baseRef: string) =>
      update((current) => ({ ...current, baseRef })),
  };
}

type ComposerLocationArgs = {
  projectId: string;
  projectName: string;
  /** The create's Workspace failure, shown on the chip until the draft moves. */
  failed: WorkspaceFailure | null;
  /** Any change to the selection means the reader is correcting the draft. */
  onChange?: () => void;
  /** The entry point's pre-fill: a deep link, or "New chat here". */
  initial?: StartLocationPrefill | null;
};

/**
 * The chip's and the cascade's one source of truth (design D10). It reads the
 * project's links, the preview route, the owner's checkouts, and Machine
 * status; the resolved location and its warning are computed from those reads,
 * never guessed locally.
 */
export function useComposerLocation({
  projectId,
  projectName,
  failed,
  onChange,
  initial,
}: ComposerLocationArgs): ComposerLocation {
  const { draft, ...actions } = useSelectionDraft(initial, onChange);
  const links = useProjectRepositoryLinksQuery(projectId);
  const repositories = useRepositoriesQuery();
  const checkouts = useCheckoutsQuery();
  const machines = useMachinesQuery();
  const preview = useStartLocationPreview(projectId, draft);
  const view = deriveLocationView({
    projectName,
    draft,
    preview,
    links: links.data ?? [],
    repositories: repositories.data ?? [],
    checkouts: checkouts.data ?? [],
    machines: machines.data,
    failed,
  });
  return {
    ...view,
    ...actions,
    selection: {
      repositoryId: draft.repositoryId,
      executorId: draft.executorId,
      checkoutId: draft.checkoutId,
    },
    preview: {
      pending: preview.isPending,
      failed: preview.isError,
      refetch: () => {
        void preview.refetch();
      },
    },
  };
}
