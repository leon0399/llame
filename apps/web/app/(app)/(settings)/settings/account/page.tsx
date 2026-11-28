import { SectionPage } from "@/app/shell/section-rail";

import { AccountSection } from "../components/account-section";

export default function AccountSettingsPage() {
  return (
    <SectionPage
      title="Account & security"
      description="Who you are signed in as, and the sessions of this account."
    >
      <AccountSection />
    </SectionPage>
  );
}
