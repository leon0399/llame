"use client";

import { useEffect, useState } from "react";

import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Textarea } from "@workspace/ui/components/textarea";

import {
  INSTRUCTIONS_MAX,
  useInstructionsQuery,
  useUpdateInstructions,
} from "@/lib/services/instructions/queries";

/**
 * Custom instructions: free text the assistant follows for tone/style across
 * the user's chats. The api merges it into the system prompt as a
 * non-authoritative block — it can't override safety or tool rules.
 */
export function CustomInstructionsSection() {
  const { data, isLoading } = useInstructionsQuery();
  const update = useUpdateInstructions();
  const [value, setValue] = useState("");

  // Hydrate the field once the saved value loads; keep local edits after.
  useEffect(() => {
    if (data) setValue(data.instructions);
  }, [data]);

  const dirty = data ? value !== data.instructions : value.length > 0;
  const overLimit = value.length > INSTRUCTIONS_MAX;

  return (
    <Card className="lg:max-w-2xl">
      <CardHeader>
        <CardTitle>Custom instructions</CardTitle>
        <CardDescription>
          Tell the assistant how you&apos;d like it to respond — tone, format,
          things to always or never do. Applied across your chats. These are
          preferences: they can&apos;t override safety or tool rules.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <>
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={6}
              placeholder="e.g. Be concise. Prefer bullet points. Assume I'm a senior engineer."
              aria-label="Custom instructions"
            />
            <p
              className={`mt-1 text-xs ${
                overLimit ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {value.length} / {INSTRUCTIONS_MAX}
            </p>
          </>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {data && dirty && (
          <Button
            variant="ghost"
            onClick={() => setValue(data.instructions)}
            disabled={update.isPending}
          >
            Reset
          </Button>
        )}
        <Button
          onClick={() => update.mutate(value.trim())}
          disabled={!dirty || overLimit || update.isPending || isLoading}
        >
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </CardFooter>
    </Card>
  );
}
