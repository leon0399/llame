"use client";

import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { KeyRoundIcon, Trash2Icon } from "lucide-react";

import {
  useDeleteProviderAccount,
  useProviderAccountsQuery,
  type ProviderAccount,
} from "@/lib/services/providers/queries";
import { AddProviderDialog } from "./add-provider-dialog";

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: "OpenRouter",
  openai_compatible: "OpenAI-compatible",
  anthropic: "Anthropic",
  google_gemini: "Google Gemini",
  aws_bedrock: "AWS Bedrock",
  ollama: "Ollama",
  custom_http: "Custom HTTP",
};

function ProviderRow({ account }: { account: ProviderAccount }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const remove = useDeleteProviderAccount();

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 items-center gap-3">
        <KeyRoundIcon className="text-muted-foreground h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">
              {account.displayName}
            </p>
            <Badge variant="secondary">
              {PROVIDER_LABELS[account.providerType] ?? account.providerType}
            </Badge>
            {!account.enabled ? (
              <Badge variant="outline">Disabled</Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground truncate text-xs">
            {account.defaultModel ?? "No default model"}
            {account.baseUrl ? ` · ${account.baseUrl}` : ""}
          </p>
        </div>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${account.displayName}`}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2Icon className="h-4 w-4" />
        </Button>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this provider?</AlertDialogTitle>
            <AlertDialogDescription>
              {account.displayName} and its stored key will be removed. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                remove.mutate(account.id, {
                  onSuccess: () => setConfirmOpen(false),
                });
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ProviderAccountsSection() {
  const { data: accounts, isLoading, isError } = useProviderAccountsQuery();

  return (
    <Card className="lg:max-w-2xl">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Model providers</CardTitle>
          <CardDescription>
            Bring your own key. Keys are encrypted on the server and used for
            your chats.
          </CardDescription>
        </div>
        <AddProviderDialog />
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        ) : isError ? (
          <p className="text-destructive text-sm">
            Could not load your providers.
          </p>
        ) : accounts && accounts.length > 0 ? (
          accounts.map((account) => (
            <ProviderRow key={account.id} account={account} />
          ))
        ) : (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No providers yet. Add one to use your own model credits.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
