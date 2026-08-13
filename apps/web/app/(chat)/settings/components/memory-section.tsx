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

/**
 * MemorySection is the owner's control over whether the assistant is told what
 * else they have been working on. It is deliberately its own card rather than a
 * field inside Personalization: that capability governs an authored profile,
 * this one governs conversation-derived history, and the two are independently
 * settable in both directions.
 *
 * The description is two lines on purpose: what is sent, where it goes, and the
 * default. The remaining consent consequences — enabling reaches chats the
 * owner already has, disabling does not unshare them, deleting a chat does not
 * erase it from prompts already sent — are documented in README.md rather than
 * stacked beside the toggle, where length would cost the reading it needs.
 *
 * @summary for the owner's chat-history sharing consent
 */
export function MemorySection() {
  const { data, isPending } = useMemoryQuery();
  const update = useUpdateMemoryMutation();

  // Header first, outside the branch: it is identical in both states, so the
  // loading card differs from the loaded one only in its body. The neighbouring
  // personalization section duplicates its header because the two versions
  // genuinely differ; here they do not, and two copies of the same prose is
  // just something to keep in sync by hand.
  return (
    <Card className="lg:max-w-2xl">
      <CardHeader>
        <CardTitle>Memory</CardTitle>
        <CardDescription>
          Choose whether the assistant may use details from your recent chats.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPending || !data ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="memory-share-recent-chats">
                  Share my recent chats
                </FieldLabel>
                {/* Two lines. What is sent, where it goes, and the default —
                    the facts needed to answer the switch in front of you.
                    The rest of the consent contract (enabling reaches chats you
                    already have, disabling does not unshare them, deleting a
                    chat does not erase it from prompts already sent) is in
                    README.md, where it can be read as prose instead of
                    crowding a toggle nobody will read past. */}
                <FieldDescription>
                  Sends titles and opening excerpts from your other chats to
                  this instance&apos;s model provider, which may be a third
                  party. Off by default.
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
