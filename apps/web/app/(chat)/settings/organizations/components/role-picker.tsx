import { ChevronDownIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";

import {
  GRANTABLE_ROLES,
  type GrantableRole,
  type OrgRole,
} from "@/lib/services/org-units/types";

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  maintainer: "Maintainer",
  member: "Member",
  viewer: "Viewer",
  guest: "Guest",
  service_account: "Service account",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as OrgRole] ?? role;
}

// No dedicated shadcn Select in @workspace/ui yet — a DropdownMenuRadioGroup
// trigger is the existing pattern for "pick one of N" in this app (see the
// theme switcher on the Settings page), reused here rather than introducing
// a new primitive for one control.
export function RolePicker({
  value,
  onChange,
  disabled,
}: {
  value: GrantableRole;
  onChange: (role: GrantableRole) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          {roleLabel(value)}
          <ChevronDownIcon className="ml-1 size-3.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as GrantableRole)}
        >
          {GRANTABLE_ROLES.map((role) => (
            <DropdownMenuRadioItem key={role} value={role}>
              {roleLabel(role)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
