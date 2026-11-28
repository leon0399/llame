"use client";

import { Alert, AlertAction, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";

import { MachineCardGrid } from "@/components/machines/machine-card";
import { useMachinesQuery } from "@/lib/services/machines/queries";

function MachinesLoadErrorAlert({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Could not load Machines.</AlertTitle>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}

/**
 * Read-only Machines, one card each. An instance whose operator configured
 * none answers 404 or an empty list, which `fetchMachines` folds into one
 * empty state: the page says so instead of standing blank.
 *
 * @summary read-only Machines status
 */
export function MachinesSection() {
  const { data, isPending, isError, refetch } = useMachinesQuery();

  if (isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </div>
    );
  }

  if (isError) {
    return <MachinesLoadErrorAlert onRetry={() => void refetch()} />;
  }

  if (data === undefined || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This instance has no Machines configured.
      </p>
    );
  }

  return <MachineCardGrid machines={data} />;
}
