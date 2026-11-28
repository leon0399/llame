import { SectionPage } from "@/app/shell/section-rail";

import { MemorySection } from "../components/memory-section";

export default function MemorySettingsPage() {
  return (
    <SectionPage
      title="Memory"
      description="Choose whether the assistant may use details from your recent chats."
    >
      <MemorySection />
    </SectionPage>
  );
}
