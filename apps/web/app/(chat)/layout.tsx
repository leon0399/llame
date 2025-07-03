
import { ChatProvider } from '@/contexts/chat-context';
import { SidebarInset, SidebarProvider, AppSidebar } from './components/app-sidebar';
import { ChatSidebar } from './components/chat-sidebar';

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
    return (
    <>
      <SidebarProvider>
        <AppSidebar />

        <ChatProvider>
          <SidebarInset>
            {children}
          </SidebarInset>

          <ChatSidebar />
        </ChatProvider>
      </SidebarProvider>
    </>
  )
}