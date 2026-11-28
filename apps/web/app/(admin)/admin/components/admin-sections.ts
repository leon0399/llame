import {
  Building2Icon,
  CpuIcon,
  PlugIcon,
  ScrollTextIcon,
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
        { key: "users", label: "Users & accounts", icon: UserCogIcon },
        { key: "models", label: "Model providers", icon: CpuIcon },
        { key: "connectors", label: "Connectors", icon: PlugIcon },
        { key: "policies", label: "Policies", icon: ShieldIcon },
        { key: "audit", label: "Audit log", icon: ScrollTextIcon },
      ],
    },
  ],
};
