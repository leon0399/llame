import type { Metadata } from "next";
import { SectionPage } from "@/app/shell/section-rail";

import { MemorySection } from "../components/memory-section";

export const metadata: Metadata = { title: "Memory" };

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
