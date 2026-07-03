"use client";

import { useState } from "react";

import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";

import { useUsageQuery } from "@/lib/services/usage/queries";

const WINDOWS = [7, 30, 90] as const;
const numberFmt = new Intl.NumberFormat("en-US");

function formatCost(costUsd: number): string {
  if (costUsd <= 0) return "$0.00";
  return costUsd < 0.01 ? `~$${costUsd.toFixed(4)}` : `~$${costUsd.toFixed(2)}`;
}

/**
 * BYOK spend — total estimated cost + tokens, a per-model breakdown, and a
 * per-day trend, aggregated from persisted per-turn usage. Cost is an estimate.
 */
export function UsageSection() {
  const [days, setDays] = useState<number>(30);
  const { data, isLoading } = useUsageQuery(days);

  const maxDayCost = Math.max(
    0.0001,
    ...(data?.byDay.map((d) => d.costUsd) ?? [0]),
  );

  return (
    <Card className="lg:max-w-2xl">
      <CardHeader>
        <CardTitle>Usage &amp; cost</CardTitle>
        <CardDescription>
          Your estimated spend over the last {days} days. Cost is an estimate
          from a built-in price table — not a provider invoice — and excludes
          regenerated and cancelled turns, so it may run lower than your bill.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={w === days ? "secondary" : "ghost"}
              onClick={() => setDays(w)}
            >
              {w}d
            </Button>
          ))}
        </div>

        {isLoading || !data ? (
          <Skeleton className="h-24 w-full" />
        ) : data.total.totalTokens === 0 ? (
          <p className="text-muted-foreground text-sm">
            No usage in this window yet.
          </p>
        ) : (
          <>
            <div className="flex gap-8">
              <div>
                <p className="text-2xl font-semibold">
                  {formatCost(data.total.costUsd)}
                </p>
                <p className="text-muted-foreground text-xs">estimated cost</p>
              </div>
              <div>
                <p className="text-2xl font-semibold">
                  {numberFmt.format(data.total.totalTokens)}
                </p>
                <p className="text-muted-foreground text-xs">
                  tokens ({numberFmt.format(data.total.inputTokens)} in /{" "}
                  {numberFmt.format(data.total.outputTokens)} out)
                </p>
              </div>
            </div>
            {data.total.turnsWithUnknownCost > 0 && (
              <p className="text-muted-foreground text-xs">
                {data.total.turnsWithUnknownCost} turn(s) have an unknown cost
                (model not priced, or the turn didn&apos;t complete).
              </p>
            )}

            <div className="space-y-1">
              <p className="text-sm font-medium">By model</p>
              <ul className="divide-border divide-y rounded-md border text-sm">
                {data.byModel.map((m) => (
                  <li
                    key={`${m.provider}/${m.model}`}
                    className="flex items-center justify-between gap-3 p-2"
                  >
                    <span className="min-w-0 truncate">{m.model}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {numberFmt.format(m.totalTokens)} tok ·{" "}
                      {formatCost(m.costUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {data.byDay.length > 1 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Daily</p>
                <ul className="space-y-1">
                  {data.byDay.map((d) => (
                    <li key={d.date} className="flex items-center gap-2">
                      <span className="text-muted-foreground w-20 shrink-0 text-xs">
                        {d.date.slice(5)}
                      </span>
                      <span className="bg-muted h-3 flex-1 overflow-hidden rounded">
                        <span
                          className="bg-primary block h-full"
                          style={{
                            width: `${Math.round((d.costUsd / maxDayCost) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className="text-muted-foreground w-16 shrink-0 text-right text-xs">
                        {formatCost(d.costUsd)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
