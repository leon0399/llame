"use client";

import { Alert, AlertAction, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";

import { SectionPage } from "@/app/shell/section-rail";
import { MachineList } from "@/components/machines/machine-list";
import { useMachinesQuery } from "@/lib/services/machines/queries";

function MachinesBody() {
  const { data, isPending, isError, refetch } = useMachinesQuery();

  if (isPending) {
    return <Skeleton className="h-44" />;
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load Machines.</AlertTitle>
        <AlertAction>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </AlertAction>
      </Alert>
    );
  }

  if (data === undefined || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This instance has no Machines configured.
      </p>
    );
  }

  return <MachineList machines={data} />;
}

/** The instance's configured Machines, as the same rows owners see. The
 *  configuration itself lives in the operator's config file. */
export default function AdminMachinesPage() {
  return (
    <SectionPage
      title="Machines"
      description="The computers this instance runs tools on, configured under machines in the instance configuration file."
    >
      {/* The rows title each Machine with an h3, so the list sits under an
          h2 as it does in Settings. */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Configured Machines</h2>
        <MachinesBody />
      </section>
    </SectionPage>
  );
}
