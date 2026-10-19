"use client";

import { PanelRightIcon, XIcon } from "lucide-react";
import { usePathname } from "next/navigation";

import { Button } from "@workspace/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet";
import { useSidebar } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";

import { topBarClasses } from "@/app/shell/top-bar";
import { useOpenChat } from "@/lib/services/chat/queries";
import {
  findMachineByName,
  machineNameFromRoot,
} from "@/lib/services/machines/locator";
import { useMachinesQuery } from "@/lib/services/machines/queries";
import { useProjectById } from "@/lib/services/project/queries";

import { EnvironmentSection } from "./environment-section";
import { useChatContextPanel } from "./panel-state";

const PANEL_TITLE = "Details";

/** The open chat's id, or undefined off a `/chat/:id` route. */
export function useOpenChatId(): string | undefined {
  const pathname = usePathname();
  return pathname.startsWith("/chat/") ? pathname.split("/")[2] : undefined;
}

/** Header button that shows or hides the panel. */
export function ChatContextPanelTrigger() {
  const { isMobile } = useSidebar();
  const { open, openMobile, toggle } = useChatContextPanel();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Toggle ${PANEL_TITLE.toLowerCase()} panel`}
      aria-expanded={isMobile ? openMobile : open}
      onClick={() => toggle(isMobile)}
    >
      <PanelRightIcon aria-hidden="true" />
    </Button>
  );
}

/** The panel's sections for one Chat. The header already loads the Chat, so
 *  this only observes its caches. */
function ChatContextPanelBody({ chatId }: { chatId: string }) {
  const chat = useOpenChat(chatId, { fetch: false });
  const workspaceRoot = chat?.workspaceRoot ?? null;
  const machineName =
    workspaceRoot === null ? undefined : machineNameFromRoot(workspaceRoot);
  const { data: machines } = useMachinesQuery(machineName !== undefined);
  const projectId = chat?.projectId ?? undefined;
  const { project, isLoading } = useProjectById(projectId);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <EnvironmentSection
        workspaceRoot={workspaceRoot}
        machineName={machineName}
        machine={findMachineByName(machines, machineName)}
        project={
          chat === undefined || (projectId !== undefined && isLoading)
            ? undefined
            : project === undefined
              ? null
              : { id: project.id, name: project.name }
        }
      />
    </div>
  );
}

function ChatContextPanelSheet({ chatId }: { chatId: string }) {
  const { openMobile, setOpenMobile } = useChatContextPanel();

  return (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{PANEL_TITLE}</SheetTitle>
          <SheetDescription className="sr-only">
            Where this chat runs and what it is attached to.
          </SheetDescription>
        </SheetHeader>
        <ChatContextPanelBody chatId={chatId} />
      </SheetContent>
    </Sheet>
  );
}

function ChatContextPanelDock({ chatId }: { chatId: string }) {
  const { open, toggle } = useChatContextPanel();
  if (!open) return null;

  return (
    <aside
      aria-label={PANEL_TITLE}
      className="hidden h-full w-72 shrink-0 flex-col border-l bg-background md:flex"
    >
      <div className={cn(topBarClasses, "justify-between gap-2 pr-2 pl-4")}>
        <span className="text-sm font-semibold">{PANEL_TITLE}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Close ${PANEL_TITLE.toLowerCase()} panel`}
          onClick={() => toggle(false)}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <ChatContextPanelBody chatId={chatId} />
    </aside>
  );
}

/**
 * The chat's right-hand context panel: docked beside the conversation on
 * desktop, a sheet on mobile. Only a `/chat/:id` route has one.
 */
export function ChatContextPanel() {
  const chatId = useOpenChatId();
  const { isMobile } = useSidebar();

  if (chatId === undefined) return null;
  return isMobile ? (
    <ChatContextPanelSheet chatId={chatId} />
  ) : (
    <ChatContextPanelDock chatId={chatId} />
  );
}
