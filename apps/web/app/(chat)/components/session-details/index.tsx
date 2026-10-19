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
import { DemoChip } from "@/app/shell/soon-chip";
import { IconButtonTooltip } from "@/components/icon-button-tooltip";
import { useOpenChat } from "@/lib/services/chat/queries";
import {
  findMachineByName,
  machineNameFromRoot,
} from "@/lib/services/machines/locator";
import { useMachinesQuery } from "@/lib/services/machines/queries";
import { useProjectById } from "@/lib/services/project/queries";

import {
  DemoChangesSection,
  DemoContextSection,
  DemoContextSummary,
} from "./demo-sections";
import type { SessionDetailsLayout } from "./details-cookie";
import {
  EnvironmentSection,
  environmentSummary,
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
  return {
    chatLoaded: chat !== undefined,
    workspaceRoot,
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
}: {
  chatId: string;
  layout: SessionDetailsLayout;
}) {
  const environment = useEnvironment(chatId);

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
          // TODO(#1355): replace the demo with the chat's real context usage.
          context: {
            title: "Context",
            badge: <DemoChip />,
            summary: <DemoContextSummary />,
            content: <DemoContextSection />,
          },
          // TODO(#1356): replace the demo with the chat's real changes.
          changes: {
            title: "Changes",
            badge: <DemoChip />,
            summary: "1 pull request",
            content: <DemoChangesSection />,
          },
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
  const { toggleSidebar } = useSidebar();

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
      <SessionDetailsBody chatId={chatId} layout={layout} />
    </Sidebar>
  );
}
