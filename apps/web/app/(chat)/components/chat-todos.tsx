"use client";

import { useState } from "react";

import {
  CheckSquareIcon,
  SquareIcon,
  Trash2Icon,
  ListTodoIcon,
  XSquareIcon,
} from "lucide-react";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";

import {
  TODO_CONTENT_MAX,
  useTodoMutations,
  useTodosQuery,
  type Todo,
} from "@/lib/services/chat/todos";

/**
 * The chat's task panel. The USER's todos are editable (toggle done, delete);
 * the AGENT's plan is shown read-through with a badge (the agent owns it — its
 * next plan-write replaces only its own list). Rendered only for an existing
 * chat (`enabled`) so it never POSTs to a not-yet-created draft chat.
 */
export function ChatTodos({
  chatId,
  enabled,
}: {
  chatId: string;
  enabled: boolean;
}) {
  const { data: todos } = useTodosQuery(chatId, enabled);
  const { add, setStatus, remove } = useTodoMutations(chatId);
  const [draft, setDraft] = useState("");

  if (!enabled) return null;

  const onAdd = () => {
    const content = draft.trim();
    if (!content || content.length > TODO_CONTENT_MAX) return;
    add.mutate(content, { onSuccess: () => setDraft("") });
  };

  const hasTodos = (todos?.length ?? 0) > 0;

  return (
    <details className="bg-muted/40 rounded-lg border text-sm" open={hasTodos}>
      <summary className="text-muted-foreground flex cursor-pointer items-center gap-2 px-3 py-2 select-none">
        <ListTodoIcon className="size-4" />
        <span>Todos{hasTodos ? ` (${todos!.length})` : ""}</span>
      </summary>
      <div className="space-y-2 px-3 pb-3">
        <ul className="space-y-1">
          {todos?.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              onToggle={() =>
                setStatus.mutate({
                  id: todo.id,
                  status: todo.status === "completed" ? "pending" : "completed",
                })
              }
              onDelete={() => remove.mutate(todo.id)}
            />
          ))}
          {!hasTodos && (
            <li className="text-muted-foreground text-xs">
              No todos yet. Add one below.
            </li>
          )}
        </ul>
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAdd();
              }
            }}
            placeholder="Add a todo…"
            aria-label="Add a todo"
            maxLength={TODO_CONTENT_MAX}
            className="h-8"
          />
          <Button
            size="sm"
            onClick={onAdd}
            disabled={!draft.trim() || add.isPending}
          >
            Add
          </Button>
        </div>
      </div>
    </details>
  );
}

function TodoRow({
  todo,
  onToggle,
  onDelete,
}: {
  todo: Todo;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const done = todo.status === "completed";
  const cancelled = todo.status === "cancelled";
  const isUser = todo.source === "user";

  const StatusIcon = done
    ? CheckSquareIcon
    : cancelled
      ? XSquareIcon
      : SquareIcon;

  return (
    <li className="flex items-start gap-2">
      <button
        type="button"
        onClick={isUser ? onToggle : undefined}
        disabled={!isUser}
        aria-label={isUser ? "Toggle done" : undefined}
        className={
          isUser
            ? "text-muted-foreground hover:text-foreground mt-0.5"
            : "text-muted-foreground mt-0.5 cursor-default"
        }
      >
        <StatusIcon className="size-4" />
      </button>
      <span
        className={`min-w-0 flex-1 break-words ${
          done || cancelled ? "text-muted-foreground line-through" : ""
        }`}
      >
        {todo.content}
      </span>
      {!isUser && (
        <Badge variant="outline" className="shrink-0 text-[10px]">
          assistant
        </Badge>
      )}
      {isUser && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete todo"
          className="text-muted-foreground hover:text-destructive mt-0.5 shrink-0"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      )}
    </li>
  );
}
