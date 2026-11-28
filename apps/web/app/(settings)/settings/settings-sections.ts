import {
  BrainIcon,
  KeyboardIcon,
  PaletteIcon,
  ServerIcon,
  SettingsIcon,
  SparklesIcon,
  UserIcon,
} from "lucide-react";

import type { SectionArea } from "@/app/shell/section-rail";

/** The owner's own settings, by what they govern: the account, how the
 *  app looks and responds to keys, what the assistant knows, and where it
 *  works. Unbuilt sections are visible "soon" rows. */
export const SETTINGS_AREA: SectionArea = {
  title: "Settings",
  icon: SettingsIcon,
  groups: [
    {
      label: "Account",
      sections: [
        {
          key: "account",
          label: "Account & security",
          icon: UserIcon,
          href: "/settings/account",
        },
      ],
    },
    {
      label: "Preferences",
      sections: [
        {
          key: "appearance",
          label: "Appearance",
          icon: PaletteIcon,
          href: "/settings/appearance",
        },
        { key: "shortcuts", label: "Keyboard shortcuts", icon: KeyboardIcon },
      ],
    },
    {
      label: "Assistant",
      sections: [
        {
          key: "personalization",
          label: "Personalization",
          icon: SparklesIcon,
          href: "/settings/personalization",
        },
        {
          key: "memory",
          label: "Memory",
          icon: BrainIcon,
          href: "/settings/memory",
        },
      ],
    },
    {
      label: "Workspace",
      sections: [
        {
          key: "machines",
          label: "Machines",
          icon: ServerIcon,
          href: "/settings/machines",
        },
      ],
    },
  ],
};
