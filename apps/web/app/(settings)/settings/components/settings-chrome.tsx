"use client";

import { MainRailTrigger } from "@/app/shell/main-rail";
import { SectionHeader, SectionRail } from "@/app/shell/section-rail";

import { SETTINGS_AREA } from "../settings-sections";

// Client wrappers: the area carries icon components, which a server layout
// cannot pass to client components as props.

export function SettingsRail() {
  return <SectionRail area={SETTINGS_AREA} />;
}

/** The mobile trigger opens the main rail, which a phone otherwise reaches
 *  through no other control on these pages. */
export function SettingsHeader() {
  return <SectionHeader area={SETTINGS_AREA} leading={<MainRailTrigger />} />;
}
