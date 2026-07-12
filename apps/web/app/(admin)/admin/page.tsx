import { redirect } from "next/navigation";

// `/admin` bare route has no content of its own — Organizations is the only
// built section, so this lands there directly (org-admin-ui spec).
export default function AdminIndexPage() {
  redirect("/admin/organizations");
}
