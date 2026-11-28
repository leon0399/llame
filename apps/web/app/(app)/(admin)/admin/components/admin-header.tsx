"use client";

import { SectionHeader } from "@/app/shell/section-rail";

import { ADMIN_AREA } from "./admin-sections";

/** "Administration › <Section>" breadcrumb, shared by every admin page. */
export function AdminHeader() {
  return <SectionHeader area={ADMIN_AREA} />;
}
