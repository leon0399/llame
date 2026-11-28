import type { Metadata } from "next";
import { SectionPage } from "@/app/shell/section-rail";

import { AppearanceSection } from "../components/appearance-section";

export const metadata: Metadata = { title: "Appearance" };

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
