'use client';

import type { User } from 'next-auth';
import { usePathname, useRouter } from 'next/navigation';

import { SidebarHistory } from '@/components/sidebar-history';
import { SidebarUserNav } from '@/components/sidebar-user-nav';
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
  useSidebar,
} from '@/components/ui/sidebar';
import Link from 'next/link';
import { PlusIcon } from './icons';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

const NEW_CHAT_SHORTCUT_KEY = 'o';

function useModifierKey() {
  const [key, setKey] = useState<'Ctrl' | '⌘'>('Ctrl'); // safe default for SSR

  useEffect(() => {
    const platform =
      navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '';

    const isMac = /Mac|iPhone|iPod|iPad/i.test(platform);
    setKey(isMac ? '⌘' : 'Ctrl');
  }, []);

  return key;
}

export function AppSidebar({ user }: { user: User | undefined }) {
  const { setOpenMobile, open: isOpen } = useSidebar();
  const router = useRouter();
  const pathname = usePathname();

  const modifierKey = useModifierKey();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === NEW_CHAT_SHORTCUT_KEY
      ) {
        event.preventDefault();
        setOpenMobile(false);
        router.push('/');
        router.refresh();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router, setOpenMobile]);

  return (
    <Sidebar className="group-data-[side=left]:border-r-0">
      <SidebarHeader>
        <SidebarMenu>
          <div className="flex flex-row justify-between items-center">
            <Link
              href="/"
              onClick={() => {
                setOpenMobile(false);
              }}
              className="flex flex-row gap-3 items-center"
            >
              <span className="text-lg font-semibold px-2 hover:bg-muted rounded-md cursor-pointer">
                Chatbot
              </span>
            </Link>
          </div>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            {/* Create chat */}
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton 
                  asChild
                  isActive={pathname === '/'}
                  className={cn('group/button')}
                >
                  <Link href="/">
                    <PlusIcon />
                    <span>New Chat</span>
                    <kbd
                      className={cn(
                        'text-muted-foreground ml-auto text-xs tracking-widest',
                        pathname === '/' ? 'opacity-100' : 'opacity-0 group-hover/button:opacity-100'
                      )}
                    >
                      {modifierKey}+Shift+{NEW_CHAT_SHORTCUT_KEY.toUpperCase()}
                    </kbd>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarHistory user={user} />
      </SidebarContent>
      <SidebarFooter>{user && <SidebarUserNav user={user} />}</SidebarFooter>
    </Sidebar>
  );
}
