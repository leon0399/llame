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
import { useProjectById } from "@/lib/services/project/queries";

import { EnvironmentSection } from "./environment-section";

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

/** The sections for one Chat. The header already loads the Chat, so this
 *  only observes its caches. */
function SessionDetailsBody({ chatId }: { chatId: string }) {
  const chat = useOpenChat(chatId, { fetch: false });
  const workspaceRoot = chat?.workspaceRoot ?? null;
  const machineName =
    workspaceRoot === null ? undefined : machineNameFromRoot(workspaceRoot);
  const { data: machines } = useMachinesQuery(machineName !== undefined);
  const project = useChatProject(
    chat?.projectId ?? undefined,
    chat !== undefined,
  );

  return (
    <SidebarContent>
      <EnvironmentSection
        workspaceRoot={workspaceRoot}
        machineName={machineName}
        machine={findMachineByName(machines, machineName)}
        project={project}
      />
    </SidebarContent>
  );
}

/**
 * The chat's session details: a second shadcn sidebar on the right,
 * offcanvas on desktop and a sheet on mobile. Only a `/chat/:id` route has
 * one.
 */
export function SessionDetails() {
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
      <SessionDetailsBody chatId={chatId} />
    </Sidebar>
  );
}
