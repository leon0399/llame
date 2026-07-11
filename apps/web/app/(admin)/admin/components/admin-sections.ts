import {
  Building2Icon,
  CpuIcon,
  PlugIcon,
  ScrollTextIcon,
  ShieldIcon,
  UserCogIcon,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";

export type AdminSection = {
  key: string;
  label: string;
  icon: LucideIcon;
  // Only built sections have a route; the rest render as visible "soon"
  // placeholders in the section nav (org-admin-ui spec — Organizations is
  // the only section this change builds).
  href?: Route;
};

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    key: "organizations",
    label: "Organizations",
    icon: Building2Icon,
    href: "/admin/organizations",
  },
  { key: "users", label: "Users & accounts", icon: UserCogIcon },
  { key: "models", label: "Model providers", icon: CpuIcon },
  { key: "connectors", label: "Connectors", icon: PlugIcon },
  { key: "policies", label: "Policies", icon: ShieldIcon },
  { key: "audit", label: "Audit log", icon: ScrollTextIcon },
];

/** Falls back to the first (built) section so the header always has a title. */
export function activeAdminSection(pathname: string): AdminSection {
  return (
    ADMIN_SECTIONS.find(
      (section) => section.href && pathname.startsWith(section.href),
    ) ?? ADMIN_SECTIONS[0]!
  );
}
