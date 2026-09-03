"use client";

import { Alert, AlertAction, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
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

// `Alert` rather than a styled span: it carries `role="alert"`, so a failure
// arriving after the skeleton has already rendered is announced. A plain
// element appearing asynchronously is silent to a screen reader — the reader
// has moved on, and nothing tells it that the region changed or that a retry
// became available.
function MemoryLoadErrorAlert({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Could not load your memory settings.</AlertTitle>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}

function ShareRecentChatsToggle({
  shareRecentChats,
  onToggle,
  saveError,
}: {
  shareRecentChats: boolean;
  onToggle: (checked: boolean) => void;
  saveError: boolean;
}) {
  return (
    <>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="memory-share-recent-chats">
            Share my recent chats
          </FieldLabel>
          {/* Two lines. What is sent, where it goes, and the default — the
              facts needed to answer the switch in front of you. The rest of
              the consent contract (enabling reaches chats you already have,
              disabling does not unshare them, deleting a chat does not erase
              it from prompts already sent) is in README.md, where it can be
              read as prose instead of crowding a toggle nobody will read
              past. */}
          <FieldDescription>
            Sends titles and opening excerpts from your other chats to this
            instance&apos;s model provider, which may be a third party. Off by
            default.
          </FieldDescription>
        </FieldContent>
        <Switch
          id="memory-share-recent-chats"
          checked={shareRecentChats}
          onCheckedChange={onToggle}
        />
      </Field>
      {/* Same defect, same fix. A save failure appears asynchronously too, so
          it needs the alert role for the same reason — an owner who just
          toggled a privacy switch and heard nothing has no way to know the
          setting did not take. */}
      {saveError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save. Try again.</AlertTitle>
        </Alert>
      ) : null}
    </>
  );
}

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
  const { data, isPending, isError, refetch } = useMemoryQuery();
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
        {/* Error before loading, and both before the happy path. A failed query
            leaves `isPending` false with `data` undefined, so a bare
            `isPending || !data` skeleton spins forever — and because the switch
            lives inside this branch, an owner who wanted to turn sharing OFF
            could not reach the control at all. A privacy setting must not
            become unreachable because a GET failed. */}
        {isError && !data ? (
          <MemoryLoadErrorAlert onRetry={() => void refetch()} />
        ) : isPending || !data ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <ShareRecentChatsToggle
            shareRecentChats={data.shareRecentChats}
            onToggle={(checked) => update.mutate({ shareRecentChats: checked })}
            saveError={update.isError}
          />
        )}
      </CardContent>
    </Card>
  );
}
