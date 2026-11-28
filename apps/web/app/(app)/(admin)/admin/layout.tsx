import { headers } from "next/headers";

import { SidebarInset } from "@/app/shell/app-sidebar";

import { AdminHeader } from "./components/admin-header";
import { AdminSectionNav } from "./components/admin-section-nav";

/** The Administration area inside the signed-in shell (`../../layout.tsx`):
 *  its section rail, the breadcrumb header and the page. */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Display-only caption for the section nav's footer ("instance · <host>").
  // Host is client-controlled unless the proxy validates it — never use this
  // value for links, redirects, or authorization.
  const headerStore = await headers();
  const host = headerStore.get("host") ?? "instance";

  return (
    <>
      <AdminSectionNav host={host} />
      <SidebarInset className="flex h-full flex-col overflow-hidden">
        <AdminHeader />
        {children}
      </SidebarInset>
    </>
  );
}
