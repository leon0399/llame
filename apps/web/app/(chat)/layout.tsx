
import { ChatProvider } from '@/contexts/chat-context';
import { SidebarInset, SidebarProvider, AppSidebar } from './components/app-sidebar';
import { ChatSidebar } from './components/chat-sidebar';
import { ChatHeader } from './components/chat-header';

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
          <SidebarInset className='flex h-screen flex-col overflow-hidden'>
            <ChatHeader className='sticky top-0 border-b' />

            {children}
          </SidebarInset>

          <ChatSidebar className="hidden!" />
        </ChatProvider>
      </SidebarProvider>
    </>
  )
}