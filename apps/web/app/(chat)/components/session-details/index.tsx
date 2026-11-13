"use client";

import { PanelRightIcon, XIcon } from "lucide-react";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  useSidebar,
} from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";

import { topBarClasses } from "@/app/shell/top-bar";
import { IconButtonTooltip } from "@/components/icon-button-tooltip";
import { useOpenChat } from "@/lib/services/chat/queries";
import {
  findMachineByName,
  machineNameFromRoot,
} from "@/lib/services/machines/locator";
import { useMachinesQuery } from "@/lib/services/machines/queries";
import { useCheckoutsQuery } from "@/lib/services/checkouts/queries";
import { useChatGitStateQuery } from "@/lib/services/git-state/queries";
import {
  useProjectById,
  useProjectRepositoryLinksQuery,
} from "@/lib/services/project/queries";
import { useRepositoriesQuery } from "@/lib/services/repositories/queries";

import { demoChangesView, demoContextView } from "./demo-sections";
import { useJobsSection } from "./jobs-section";
import type { SessionDetailsLayout } from "./details-cookie";
import {
  EnvironmentSection,
  environmentSummary,
  type EnvironmentCheckout,
  type EnvironmentGitState,
  type EnvironmentSectionProps,
} from "./environment-section";
import { SectionList } from "./section-list";

const DETAILS_TITLE = "Session details";
const SHOW_LABEL = "Show session details";
const HIDE_LABEL = "Hide session details";

/** The open chat's id, or undefined off a `/chat/:id` route. */
export function useOpenChatId(): string | undefined {
  const pathname = usePathname();

  return pathname.startsWith("/chat/") ? pathname.split("/")[2] : undefined;
}

/** Header button that shows or hides session details. Must sit under their
 *  provider, where `useSidebar` is theirs. */
export function SessionDetailsTrigger() {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar();
  const shown = isMobile ? openMobile : open;

  return (
    <IconButtonTooltip
      label={shown ? HIDE_LABEL : SHOW_LABEL}
      size="icon-sm"
      side="bottom"
      align="end"
      aria-expanded={shown}
      onClick={toggleSidebar}
    >
      <PanelRightIcon aria-hidden="true" />
    </IconButtonTooltip>
  );
}

/** The project the chat is filed in, once known. */
function useChatProject(projectId: string | undefined, chatLoaded: boolean) {
  const { project, isLoading } = useProjectById(projectId);

  if (!chatLoaded || (projectId !== undefined && isLoading)) return undefined;

  return project === undefined ? null : { id: project.id, name: project.name };
}

/**
 * The registered checkout the Workspace root is, with its repository under
 * the name the Chat's Project gives it. Null when the root is no registered
 * checkout; undefined until the reads settle.
 */
function useWorkspaceCheckout(
  workspaceRoot: string | null,
  projectId: string | undefined,
): EnvironmentCheckout | null | undefined {
  const bound = workspaceRoot !== null;
  const checkouts = useCheckoutsQuery(undefined, bound);
  const repositories = useRepositoriesQuery(bound);

  const links = useProjectRepositoryLinksQuery(
    projectId ?? "",
    bound && projectId !== undefined,
  );

  if (!bound) return null;

  if (checkouts.data === undefined || repositories.data === undefined) {
    return undefined;
  }

  const checkout = checkouts.data.find((row) => row.path === workspaceRoot);

  if (checkout === undefined) return null;

  const repository = repositories.data.find(
    (row) => row.id === checkout.repositoryId,
  );

  const link = links.data?.find(
    (row) => row.repositoryId === checkout.repositoryId,
  );

  return {
    repository: link?.alias ?? repository?.displayName ?? "Repository",
    remote: repository?.canonicalRemote ?? null,
    kind: checkout.kind,
  };
}

/** The live repository state, read while the panel is open on a bound Chat. */
function useGitState(
  chatId: string,
  workspaceRoot: string | null,
): EnvironmentGitState {
  const { isMobile, open, openMobile } = useSidebar();

  const query = useChatGitStateQuery(
    chatId,
    workspaceRoot,
    isMobile ? openMobile : open,
  );

  if (query.isError) return { status: "error" };

  return query.data ?? { status: "loading" };
}

/** The Chat's environment, read from the caches the header already loads. */
function useEnvironment(chatId: string): EnvironmentSectionProps {
  const chat = useOpenChat(chatId, { fetch: false });
  const workspaceRoot = chat?.workspaceRoot ?? null;

  const machineName =
    workspaceRoot === null ? undefined : machineNameFromRoot(workspaceRoot);

  const machinesQuery = useMachinesQuery(machineName !== undefined);

  const project = useChatProject(
    chat?.projectId ?? undefined,
    chat !== undefined,
  );

  const checkout = useWorkspaceCheckout(
    workspaceRoot,
    chat?.projectId ?? undefined,
  );

  const gitState = useGitState(chatId, workspaceRoot);

  return {
    chatLoaded: chat !== undefined,
    workspaceRoot,
    checkout,
    gitState,
    machineName,
    machine: findMachineByName(machinesQuery.data, machineName),
    // A disabled query also reads as pending, so only a Machine root waits.
    machineLoading: machineName !== undefined && machinesQuery.isPending,
    project,
  };
}

function SessionDetailsBody({
  chatId,
  layout,
  panelOpen,
}: {
  chatId: string;
  layout: SessionDetailsLayout;
  panelOpen: boolean;
}) {
  const environment = useEnvironment(chatId);
  const jobs = useJobsSection(chatId, panelOpen);

  return (
    <SidebarContent>
      <SectionList
        initialLayout={layout}
        sections={{
          environment: {
            title: "Environment",
            summary: environmentSummary(environment),
            content: <EnvironmentSection {...environment} />,
          },
          jobs,
          context: demoContextView,
          changes: demoChangesView,
        }}
      />
    </SidebarContent>
  );
}

/**
 * The chat's session details: a second shadcn sidebar on the right,
 * offcanvas on desktop and a sheet on mobile. Only a `/chat/:id` route has
 * one.
 */
export function SessionDetails({ layout }: { layout: SessionDetailsLayout }) {
  const chatId = useOpenChatId();
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar();
  const panelOpen = isMobile ? openMobile : open;

  if (chatId === undefined) return null;

  return (
    <Sidebar side="right" collapsible="offcanvas" aria-label={DETAILS_TITLE}>
      <div className={cn(topBarClasses, "justify-between gap-2 pr-2 pl-4")}>
        <span className="text-sm font-semibold">{DETAILS_TITLE}</span>
        <IconButtonTooltip
          label={HIDE_LABEL}
          size="icon-sm"
          side="bottom"
          align="end"
          onClick={toggleSidebar}
        >
          <XIcon aria-hidden="true" />
        </IconButtonTooltip>
      </div>
      <SessionDetailsBody
        chatId={chatId}
        layout={layout}
        panelOpen={panelOpen}
      />
    </Sidebar>
  );
}
