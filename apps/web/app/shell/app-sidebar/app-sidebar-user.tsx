import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@workspace/ui/components/sidebar";

import Link from "next/link";
import {
  BadgeCheckIcon,
  BellIcon,
  ChevronsUpDownIcon,
  CreditCardIcon,
  LogOutIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";

import {
  logout,
  useMe,
  type PublicUserResponse,
} from "@/lib/services/auth/queries";

function UserAvatar({
  user,
  displayInitials,
}: {
  user: PublicUserResponse;
  displayInitials: string;
}) {
  return (
    <Avatar className="h-8 w-8 rounded-lg">
      {user.image && <AvatarImage src={user.image} />}
      <AvatarFallback className="rounded-lg">{displayInitials}</AvatarFallback>
    </Avatar>
  );
}

function AccountMenuHeader({
  user,
  displayName,
  displayInitials,
}: {
  user: PublicUserResponse;
  displayName: string;
  displayInitials: string;
}) {
  return (
    <DropdownMenuLabel className="p-0 font-normal">
      <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm h-12">
        <UserAvatar user={user} displayInitials={displayInitials} />
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{displayName}</span>
          <span className="truncate text-xs">{user.email}</span>
        </div>
      </div>
    </DropdownMenuLabel>
  );
}

// Not-yet-implemented account surfaces — disabled placeholders, never hidden
// or dead clicks (repo convention).
function DisabledAccountMenuItems() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem disabled>
          <SparklesIcon />
          Upgrade to Pro
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem disabled>
          <BadgeCheckIcon />
          Account
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <CreditCardIcon />
          Billing
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <BellIcon />
          Notifications
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

function AccountMenuContent({
  user,
  displayName,
  displayInitials,
  isMobile,
}: {
  user: PublicUserResponse;
  displayName: string;
  displayInitials: string;
  isMobile: boolean;
}) {
  return (
    <DropdownMenuContent
      className="w-(--anchor-width) min-w-56 rounded-lg"
      side={isMobile ? "bottom" : "right"}
      align="end"
      sideOffset={4}
    >
      <AccountMenuHeader
        user={user}
        displayName={displayName}
        displayInitials={displayInitials}
      />
      <DropdownMenuSeparator />
      <DisabledAccountMenuItems />
      <DropdownMenuGroup>
        <DropdownMenuItem render={<Link href="/settings" />}>
          <SettingsIcon />
          Settings
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => void logout()}>
        <LogOutIcon />
        Log out
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

export function AppSidebarUser() {
  const { isMobile } = useSidebar();
  const { data: user } = useMe();

  const displayName =
    user?.name || user?.email?.split("@")[0] || user?.id?.slice(0, 8) || "User";
  const displayInitials =
    displayName
      ?.split(/\W+/)
      .map((name) => name.charAt(0).toUpperCase())
      .slice(0, 2)
      .join("") || "--";

  if (!user) {
    return null; // or a loading state, or a placeholder
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
            <UserAvatar user={user} displayInitials={displayInitials} />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{displayName}</span>
              <span className="truncate text-xs">{user.email}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <AccountMenuContent
            user={user}
            displayName={displayName}
            displayInitials={displayInitials}
            isMobile={isMobile}
          />
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
