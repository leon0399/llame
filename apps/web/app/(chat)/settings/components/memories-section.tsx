"use client";

import { useState } from "react";

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
import { Textarea } from "@workspace/ui/components/textarea";
import { toast } from "@workspace/ui/components/sonner";
import { Trash2Icon } from "lucide-react";

import {
  MEMORY_CONTENT_MAX,
  useCreateMemory,
  useDeleteMemory,
  useMemoriesQuery,
} from "@/lib/services/memories/queries";

/**
 * Manage the durable facts the assistant remembers. Memories added here
 * (source "user") are automatically available to the assistant across chats;
 * "assistant"-saved memories are shown for transparency and can be removed.
 */
export function MemoriesSection() {
  const { data: memories, isLoading } = useMemoriesQuery();
  const create = useCreateMemory();
  const remove = useDeleteMemory();
  const [draft, setDraft] = useState("");

  const trimmed = draft.trim();
  const overLimit = trimmed.length > MEMORY_CONTENT_MAX;

  const onAdd = () => {
    if (!trimmed || overLimit) return;
    create.mutate(trimmed, {
      onSuccess: () => setDraft(""),
      onError: () =>
        toast.error(
          "Couldn't save that memory — it may be a duplicate or you've hit the limit.",
        ),
    });
  };

  return (
    <Card className="lg:max-w-2xl">
      <CardHeader>
        <CardTitle>Memory</CardTitle>
        <CardDescription>
          Durable facts the assistant remembers about you, available across your
          chats. Add things you&apos;d like it to always know.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="e.g. I work in TypeScript. Prefer metric units. My timezone is CET."
            aria-label="New memory"
          />
          <div className="flex items-center justify-between">
            <span
              className={`text-xs ${
                overLimit ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {trimmed.length} / {MEMORY_CONTENT_MAX}
            </span>
            <Button
              size="sm"
              onClick={onAdd}
              disabled={!trimmed || overLimit || create.isPending}
            >
              {create.isPending ? "Adding…" : "Add memory"}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : memories && memories.length > 0 ? (
          <ul className="divide-border divide-y rounded-md border">
            {memories.map((m) => (
              <li
                key={m.id}
                className="flex items-start justify-between gap-3 p-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm break-words">{m.content}</p>
                  <Badge
                    variant={m.source === "user" ? "secondary" : "outline"}
                    className="text-xs"
                  >
                    {m.source === "user" ? "You" : "Assistant"}
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete memory"
                  onClick={() => remove.mutate(m.id)}
                  disabled={remove.isPending}
                >
                  <Trash2Icon className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            No memories yet. Add one above, or the assistant may save some as
            you chat.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
