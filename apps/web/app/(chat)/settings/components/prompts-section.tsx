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
import { Input } from "@workspace/ui/components/input";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Textarea } from "@workspace/ui/components/textarea";
import { toast } from "@workspace/ui/components/sonner";
import { PencilIcon, Trash2Icon } from "lucide-react";

import {
  PROMPT_CONTENT_MAX,
  useCreatePrompt,
  useDeletePrompt,
  usePromptsQuery,
  useUpdatePrompt,
} from "@/lib/services/prompts/queries";

const NAME_OK = /^[A-Za-z0-9_-]+$/;

/**
 * Manage saved prompts — reusable templates inserted in the composer by typing
 * `/<name>`. Name is a slug (no spaces) so the trigger is unambiguous.
 */
export function PromptsSection() {
  const { data: prompts, isLoading } = usePromptsQuery();
  const create = useCreatePrompt();
  const update = useUpdatePrompt();
  const remove = useDeletePrompt();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");

  const nameOk = NAME_OK.test(name);
  const contentOk =
    content.trim().length > 0 && content.length <= PROMPT_CONTENT_MAX;
  const pending = create.isPending || update.isPending;

  const reset = () => {
    setEditingId(null);
    setName("");
    setContent("");
  };

  const startEdit = (p: { id: string; name: string; content: string }) => {
    setEditingId(p.id);
    setName(p.name);
    setContent(p.content);
  };

  const onSave = () => {
    if (!nameOk || !contentOk) return;
    const onError = () =>
      toast.error(
        `Couldn't save "/${name}" — the name may already be taken.`,
      );
    if (editingId) {
      update.mutate(
        { id: editingId, patch: { name, content: content.trim() } },
        { onSuccess: reset, onError },
      );
    } else {
      create.mutate(
        { name, content: content.trim() },
        { onSuccess: reset, onError },
      );
    }
  };

  return (
    <Card className="lg:max-w-2xl">
      <CardHeader>
        <CardTitle>Prompts</CardTitle>
        <CardDescription>
          Reusable prompt templates. Insert one in a chat by typing{" "}
          <code>/name</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="name (e.g. summarize)"
            aria-label="Prompt name"
          />
          {name.length > 0 && !nameOk && (
            <p className="text-destructive text-xs">
              Use letters, digits, underscore or hyphen — no spaces.
            </p>
          )}
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            placeholder="The prompt body, e.g. 'Summarize the following concisely:'"
            aria-label="Prompt content"
          />
          <div className="flex items-center justify-end gap-2">
            {editingId && (
              <Button size="sm" variant="ghost" onClick={reset}>
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              onClick={onSave}
              disabled={!nameOk || !contentOk || pending}
            >
              {editingId ? "Save" : "Add prompt"}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : prompts && prompts.length > 0 ? (
          <ul className="divide-border divide-y rounded-md border">
            {prompts.map((p) => (
              <li
                key={p.id}
                className="flex items-start justify-between gap-3 p-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">/{p.name}</p>
                  <p className="text-muted-foreground line-clamp-2 text-xs break-words">
                    {p.content}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit prompt"
                    onClick={() => startEdit(p)}
                  >
                    <PencilIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete prompt"
                    onClick={() => remove.mutate(p.id)}
                    disabled={remove.isPending}
                  >
                    <Trash2Icon className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            No saved prompts yet. Add one above, then type <code>/name</code> in
            a chat.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
