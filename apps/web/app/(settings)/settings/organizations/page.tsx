import { redirect } from "next/navigation";

// Relocated to the Administration area (admin-area-org-tree change, task
// 2.4) — instance administration is a different actor/mental-model than
// personal settings. Deep links here must still land correctly.
export default function OrganizationsSettingsRedirectPage() {
  redirect("/admin/organizations");
}
