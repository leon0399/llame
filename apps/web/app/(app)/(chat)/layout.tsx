import { cookies } from "next/headers";

import { SidebarInset } from "@/app/shell/app-sidebar";
import { ChatProvider } from "@/contexts/chat-context";

import { ChatListSidebar } from "./components/chat-list-sidebar";
import { ProjectListSidebar } from "./components/project-list-sidebar";
import { ChatHeader } from "./components/chat-header";
import { SessionDetails } from "./components/session-details";
import {
  SESSION_DETAILS_COOKIE,
  SESSION_DETAILS_LAYOUT_COOKIE,
  parseSessionDetailsLayout,
} from "./components/session-details/details-cookie";
import { SessionDetailsProvider } from "./components/session-details/details-state";

/** Session details start open until a user hides them, with their sections
 *  as the user arranged them. */
async function readDetailsState() {
  const cookieStore = await cookies();

  return {
    detailsOpen: cookieStore.get(SESSION_DETAILS_COOKIE)?.value !== "false",
    detailsLayout: parseSessionDetailsLayout(
      cookieStore.get(SESSION_DETAILS_LAYOUT_COOKIE)?.value,
    ),
  };
}

/** The chats area inside the signed-in shell (`../layout.tsx`): its second
 *  rails, the chat header, the page and session details. */
export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { detailsOpen, detailsLayout } = await readDetailsState();

  return (
    <ChatProvider>
      {/* Route-scoped second rails: each renders null off its route. */}
      <ChatListSidebar />
      <ProjectListSidebar />

      <SessionDetailsProvider defaultOpen={detailsOpen}>
        <SidebarInset className="flex h-full flex-col overflow-hidden">
          <ChatHeader className="sticky top-0" />

          {children}
        </SidebarInset>

        <SessionDetails layout={detailsLayout} />
      </SessionDetailsProvider>
    </ChatProvider>
  );
}
