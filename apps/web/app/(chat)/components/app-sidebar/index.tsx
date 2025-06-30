'use client';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '@workspace/ui/components/sidebar';
import { AppSidebarActions } from './app-sidebar-actions';
import Link from 'next/link';
import { Button } from '@workspace/ui/components/button';
import { PanelLeftIcon, SparklesIcon } from 'lucide-react';

export { SidebarInset, SidebarProvider } from '@workspace/ui/components/sidebar';

export function AppSidebar() {
  const { setOpenMobile, open: isOpen, toggleSidebar } = useSidebar();

  return (
    <Sidebar 
      collapsible='icon'
      className="group-data-[side=left]:border-r-0"
    >
      <SidebarHeader>
        <AppSidebarActions />
      </SidebarHeader>
      <SidebarContent>
      </SidebarContent>
    </Sidebar>
  )
}