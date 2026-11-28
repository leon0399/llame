import type { Metadata } from "next";
import { SidebarInset } from "@/app/shell/app-sidebar";

import { SettingsHeader, SettingsRail } from "./components/settings-chrome";

export const metadata: Metadata = {
  title: { default: "Settings", template: "%s · Settings · llame" },
};

/** The Settings area inside the signed-in shell (`../../layout.tsx`): its
 *  section rail, the breadcrumb header and the page. */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SettingsRail />
      <SidebarInset className="flex h-full flex-col overflow-hidden">
        <SettingsHeader />
        {children}
      </SidebarInset>
    </>
  );
}
