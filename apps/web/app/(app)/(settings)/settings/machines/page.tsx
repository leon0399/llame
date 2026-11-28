import type { Metadata } from "next";
import { PlusIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";

import { SectionPage } from "@/app/shell/section-rail";
import { SoonChip } from "@/app/shell/soon-chip";

import { MachinesSection } from "../components/machines-section";

export const metadata: Metadata = { title: "Machines" };

/** Shared Machines today; the owner's own Machines are a visible placeholder.
 *  TODO(#1994): owners adding Machines only they can use. */
export default function MachinesSettingsPage() {
  return (
    <SectionPage
      title="Machines"
      description="The computers the assistant runs tools on."
    >
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Shared Machines</h2>
          <p className="text-sm text-muted-foreground">
            Configured by the operator for everyone on this instance, including
            its own host. Live usage, updating a daemon, and turning a Machine
            off for yourself are coming soon.
          </p>
        </div>
        <MachinesSection />
      </section>
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="inline-flex items-center gap-2 text-base font-semibold">
              Your Machines
              <SoonChip />
            </h2>
            <p className="text-sm text-muted-foreground">
              Computers only you can use, added from here.
            </p>
          </div>
          <Button variant="outline" size="sm" disabled>
            <PlusIcon aria-hidden />
            Add a Machine
          </Button>
        </div>
      </section>
    </SectionPage>
  );
}
