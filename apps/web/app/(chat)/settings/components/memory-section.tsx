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
 * The description beside the switch is not marketing copy — it is the consent
 * contract, and it is incomplete unless all three consequences appear together.
 * See the story assertions before shortening any of them.
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
                {/* One paragraph of ordinary prose, deliberately. `FieldDescription`
                    renders a `<p>`, so per-sentence elements would have to be
                    `<span>`s glued with explicit `{" "}` — and dropping one of those
                    glue tokens silently runs two sentences together, which no test
                    would catch. The stories assert each consequence with
                    `toHaveTextContent` against this element instead, which needs no
                    element boundary per sentence. */}
                <FieldDescription>
                  Off by default. When enabled, titles and opening excerpts from
                  your other chats are sent to the model provider this instance
                  is configured to use, which may be a third party with no
                  relationship to you. Turning it on covers every chat you
                  already have, including ones from long before you opted in.
                  Turning it off stops building the list for new chats and stops
                  adding to or refreshing the lists already built — but a chat
                  that already has one keeps sending it. Deleting a chat does
                  not remove its title or excerpt from lists already built into
                  other chats, from messages already stored, or from receipts
                  already issued.
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
