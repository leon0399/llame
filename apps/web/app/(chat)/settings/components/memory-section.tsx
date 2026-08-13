"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Switch } from "@workspace/ui/components/switch";

import { useUpdateMemoryMutation } from "@/lib/services/memory/mutations";
import { useMemoryQuery } from "@/lib/services/memory/queries";

export function MemorySection() {
  const { data, isPending } = useMemoryQuery();
  const update = useUpdateMemoryMutation();

  if (isPending || !data) {
    return (
      <Card className="lg:max-w-2xl">
        <CardHeader>
          <CardTitle>Memory</CardTitle>
          <CardDescription>
            Choose whether the assistant may use details from your recent chats.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="lg:max-w-2xl">
      <CardHeader>
        <CardTitle>Memory</CardTitle>
        <CardDescription>
          Choose whether the assistant may use details from your recent chats.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="memory-share-recent-chats">
              Share my recent chats
            </FieldLabel>
            <FieldDescription>
              <span>
                Off by default. When enabled, titles and opening excerpts from
                your other chats are sent to the model provider this instance is
                configured to use, which may be a third party with no
                relationship to you.
              </span>{" "}
              <span>
                Enabling applies to your whole existing corpus, including chats
                and opening excerpts created before you opt in.
              </span>{" "}
              <span>
                Turning it off stops new baselines, re-bakes, and appends, but
                chats that already have a baseline keep sending it.
              </span>{" "}
              <span>
                Deleting a chat does not erase its title and excerpt from other
                chats&apos; already-bound prompts, persisted appends, or
                receipts already issued.
              </span>
            </FieldDescription>
          </FieldContent>
          <Switch
            id="memory-share-recent-chats"
            checked={data.shareRecentChats}
            onCheckedChange={(checked) =>
              update.mutate({ shareRecentChats: checked })
            }
          />
        </Field>
        {update.isError ? (
          <span className="text-sm text-destructive">
            Could not save. Try again.
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}
