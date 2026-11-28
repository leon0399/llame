import { SectionPage } from "@/app/shell/section-rail";

import { ShortcutsSection } from "../components/shortcuts-section";

export default function ShortcutsSettingsPage() {
  return (
    <SectionPage
      title="Keyboard shortcuts"
      description="Click a shortcut and press the new keys; Esc cancels. Bindings and usage counts are kept in this browser."
    >
      <ShortcutsSection />
    </SectionPage>
  );
}
