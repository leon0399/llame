import { SidebarInset } from "@/app/shell/app-sidebar";

import { SettingsHeader, SettingsRail } from "./components/settings-chrome";

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
