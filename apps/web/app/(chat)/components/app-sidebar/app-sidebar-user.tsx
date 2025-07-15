
import { useSession } from "next-auth/react";

import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@workspace/ui/components/sidebar";

import Link from "next/link";
import { BadgeCheckIcon, BellIcon, ChevronsUpDownIcon, CreditCardIcon, LogOutIcon, SettingsIcon, SparklesIcon } from "lucide-react";

import crypto from "crypto";

export function AppSidebarUser() {
  const { isMobile } = useSidebar()
  const { data: session } = useSession();
  const user = session?.user;

  const displayName = user?.name || user?.email?.split('@')[0] || user?.id?.slice(0, 8) || 'User';
  const displayInitials = displayName?.split(/\W+/).map(name => name.charAt(0).toUpperCase()).slice(0, 2).join('') || '--';

  const gravatarEmail = user?.email?.trim().toLowerCase().replace(/ /g, '');
  const gravatarHash = gravatarEmail ? crypto.createHash('md5').update(gravatarEmail).digest('hex') : null;
  const gravatarUrl = gravatarHash ? `https://www.gravatar.com/avatar/${gravatarHash}?d=identicon` : null;

  if (!user) {
    return null; // or a loading state, or a placeholder
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="h-12">
              <Avatar className="h-8 w-8 rounded-lg block">
                {gravatarUrl && <AvatarImage src={gravatarUrl} />}
                <AvatarFallback className="rounded-lg">{displayInitials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayName}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm h-12">
                <Avatar className="h-8 w-8 rounded-lg">
                  {gravatarUrl && <AvatarImage src={gravatarUrl} />}
                  <AvatarFallback className="rounded-lg">{displayInitials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{displayName}</span>
                  <span className="truncate text-xs">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <SparklesIcon />
                Upgrade to Pro
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <BadgeCheckIcon />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CreditCardIcon />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem>
                <BellIcon />
                Notifications
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <SettingsIcon />
                  Settings
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <LogOutIcon />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}