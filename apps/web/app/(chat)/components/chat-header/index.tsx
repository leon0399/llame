import { SidebarTrigger } from "@workspace/ui/components/sidebar";

export function PureChatHeader() {
  return (
    <header className="flex sticky top-0 bg-background py-1.5 items-center px-2 md:px-2 gap-2">
      <SidebarTrigger />
    </header>
  )
}

export const ChatHeader = PureChatHeader;