import { SectionPage } from "@/app/shell/section-rail";

import { PersonalizationSection } from "../components/personalization-section";

export default function PersonalizationSettingsPage() {
  return (
    <SectionPage
      title="Personalization"
      description="What the assistant calls you, what it knows about you, and how you like answers."
    >
      <PersonalizationSection />
    </SectionPage>
  );
}
