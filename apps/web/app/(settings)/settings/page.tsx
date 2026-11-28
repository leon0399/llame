import { redirect } from "next/navigation";

// `/settings` has no content of its own: it opens the first section.
export default function SettingsIndexPage() {
  redirect("/settings/account");
}
