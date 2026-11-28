import { SectionPage } from "@/app/shell/section-rail";

import { AppearanceSection } from "../components/appearance-section";

export default function AppearanceSettingsPage() {
  return (
    <SectionPage
      title="Appearance"
      description="Theme and fonts, for this browser."
    >
      <AppearanceSection />
    </SectionPage>
  );
}
