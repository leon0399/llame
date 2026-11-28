import {
  Building2Icon,
  CloudIcon,
  CpuIcon,
  PlugIcon,
  ScrollTextIcon,
  ServerIcon,
  ShieldIcon,
  UserCogIcon,
} from "lucide-react";

import type { SectionArea } from "@/app/shell/section-rail";

// Only built sections have a route; the rest render as visible "soon"
// placeholders in the rail (org-admin-ui spec).
export const ADMIN_AREA: SectionArea = {
  title: "Administration",
  icon: ShieldIcon,
  groups: [
    {
      label: "Instance",
      sections: [
        {
          key: "organizations",
          label: "Organizations",
          icon: Building2Icon,
          href: "/admin/organizations",
        },
        {
          key: "machines",
          label: "Machines",
          icon: ServerIcon,
          href: "/admin/machines",
        },
        {
          key: "models",
          label: "Models",
          icon: CpuIcon,
          href: "/admin/models",
        },
        { key: "providers", label: "Model providers", icon: CloudIcon },
        { key: "users", label: "Users & accounts", icon: UserCogIcon },
        { key: "connectors", label: "Connectors", icon: PlugIcon },
        { key: "policies", label: "Policies", icon: ShieldIcon },
        { key: "audit", label: "Audit log", icon: ScrollTextIcon },
      ],
    },
  ],
};
