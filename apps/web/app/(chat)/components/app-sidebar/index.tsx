'use client';

import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarSeparator,
  useSidebar,
} from '@workspace/ui/components/sidebar';
import { AppSidebarActions } from './app-sidebar-actions';
import { AppSidebarChatHistory } from './app-sidebar-chat-history';
import { AppSidebarProjects } from './app-sidebar-projects';
import { AppSidebarUser } from './app-sidebar-user';

export { SidebarInset, SidebarProvider } from '@workspace/ui/components/sidebar';

export function AppSidebar() {
  const { setOpenMobile, open: isOpen, toggleSidebar } = useSidebar();

  return (
    <Sidebar 
      collapsible='icon'
    >
      <SidebarHeader>
        <AppSidebarActions />
      </SidebarHeader>

      <SidebarSeparator className='mx-0' />

      <SidebarContent>
        {isOpen && (
          <>
            <AppSidebarProjects />
            <SidebarSeparator className='mx-0' />
            <AppSidebarChatHistory />
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        <AppSidebarUser />
      </SidebarFooter>
    </Sidebar>
  )
}