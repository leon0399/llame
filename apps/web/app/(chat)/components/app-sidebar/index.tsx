'use client';

import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from '@workspace/ui/components/sidebar';
import { cn } from '@workspace/ui/lib/utils';
import { PanelLeftIcon } from 'lucide-react';
import { topBarClasses } from '../top-bar';
import { AppSidebarActions } from './app-sidebar-actions';
import { AppSidebarNav } from './app-sidebar-nav';
import { AppSidebarSearch } from './app-sidebar-search';
import { AppSidebarUser } from './app-sidebar-user';
import { ChatList } from '../chat-list-sidebar/chat-list';

export { SidebarInset, SidebarProvider } from '@workspace/ui/components/sidebar';

function AppSidebarToggle() {
  const { open, toggleSidebar } = useSidebar();
  const label = open ? 'Collapse sidebar' : 'Expand sidebar';

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton tooltip={label} onClick={toggleSidebar}>
          <PanelLeftIcon />
          <span>{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar() {
  const { isMobile } = useSidebar();

  return (
    <Sidebar
      collapsible='icon'
    >
      {!isMobile && (
        <div className={cn(topBarClasses, 'border-sidebar-border p-2')}>
          <AppSidebarToggle />
        </div>
      )}

      <SidebarHeader>
        <AppSidebarActions />
      </SidebarHeader>

      <SidebarSeparator className='mx-0' />

      <SidebarContent>
        <AppSidebarNav />

        {/* The nested chats sidebar is desktop-only; keep chats reachable in the mobile sheet. */}
        {isMobile && (
          <>
            <AppSidebarSearch />
            <SidebarSeparator className='mx-0' />
            <ChatList />
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        <AppSidebarUser />
      </SidebarFooter>
    </Sidebar>
  )
}
