"use client";

// DEMO ONLY — static placeholder blocks to judge how session details look
// with several groups. Not wired to any data; delete before committing.

import { GitPullRequestIcon } from "lucide-react";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

function UsageBar() {
  return (
    <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span className="block h-full w-1/9 rounded-full bg-foreground" />
      <span className="absolute inset-y-0 left-3/4 w-px bg-destructive" />
    </span>
  );
}

export function DemoContextSection() {
  return (
    <>
      <div className="space-y-1.5 px-2 pb-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Context window</span>
          <span>11%</span>
        </div>
        <UsageBar />
        <div className="flex justify-between font-mono text-xs text-muted-foreground">
          <span>14.2k used</span>
          <span>compaction 96k</span>
          <span>128k</span>
        </div>
      </div>
      <ValueRow label="Input" value="14k" />
      <ValueRow label="Output" value="213" />
      <ValueRow label="Estimated cost" value="$0.037" />
    </>
  );
}

export function DemoContextSummary() {
  return (
    <span className="flex items-center gap-2">
      11%
      <span className="w-8">
        <UsageBar />
      </span>
    </span>
  );
}

export function DemoChangesSection() {
  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton>
            <GitPullRequestIcon />
            <span>feat(machines): experimental remote Machines</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <div className="flex gap-2 px-2 pl-8 font-mono text-xs">
        <span className="text-muted-foreground">#1339</span>
        <span>+23,332</span>
        <span className="text-destructive">−478</span>
        <span className="ml-auto text-muted-foreground">CI 40/42</span>
      </div>
    </>
  );
}
