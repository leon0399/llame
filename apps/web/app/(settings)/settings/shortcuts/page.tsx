import type { Metadata } from "next";
import { SectionPage } from "@/app/shell/section-rail";

import { ShortcutsSection } from "../components/shortcuts-section";

export const metadata: Metadata = { title: "Keyboard shortcuts" };

export default function ShortcutsSettingsPage() {
  return (
    <SectionPage
      title="Keyboard shortcuts"
      description="Change a shortcut with its pencil, then press the new keys. Bindings and usage counts are kept in this browser."
    >
      <ShortcutsSection />
    </SectionPage>
  );
}
