"use client";

import { SectionRail } from "@/app/shell/section-rail";

import { ADMIN_AREA } from "./admin-sections";

/** The admin area's second rail (D1), with the instance caption in its
 *  footer. Desktop-only; the primary-rail "Administration" entry is too. */
export function AdminSectionNav({ host }: { host: string }) {
  return (
    <SectionRail
      area={ADMIN_AREA}
      footer={
        <div className="border-t px-4.5 py-3.5 font-mono text-xs text-muted-foreground">
          instance · {host}
        </div>
      }
    />
  );
}
