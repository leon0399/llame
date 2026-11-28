import { SectionPage } from "@/app/shell/section-rail";

import { MachinesSection } from "../components/machines-section";

export default function MachinesSettingsPage() {
  return (
    <SectionPage
      title="Machines"
      description="Machines this instance runs tools on, including its own host. The operator configures them; this list is read-only."
    >
      <MachinesSection />
    </SectionPage>
  );
}
