import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import { chatQueryKeys } from "./queries";

/**
 * Chat todos — the task panel. The user's todos (`source: 'user'`) are managed
 * here; the agent's plan (`source: 'agent'`) is shown read-through. The api
 * owns the source boundary (an agent plan-write never wipes the user's list).
 */
export const TODO_CONTENT_MAX = 500;

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TodoSource = "user" | "agent";

export type Todo = {
  id: string;
  content: string;
  status: TodoStatus;
  source: TodoSource;
  position: number;
};

const base = (chatId: string) => `/api/v1/chats/${chatId}/todos`;

export function useTodosQuery(chatId: string, enabled: boolean) {
  return useQuery({
    queryKey: chatQueryKeys.todos(chatId),
    queryFn: () => api.get(buildApiUrl(base(chatId))).json<Todo[]>(),
    enabled: enabled && chatId.length > 0,
    staleTime: 15_000,
  });
}

export function useTodoMutations(chatId: string) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: chatQueryKeys.todos(chatId) });

  const add = useMutation({
    mutationFn: (content: string) =>
      api.post(buildApiUrl(base(chatId)), { json: { content } }).json<Todo>(),
    onSuccess: invalidate,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TodoStatus }) =>
      api
        .patch(buildApiUrl(`${base(chatId)}/${id}`), { json: { status } })
        .json<Todo>(),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api.delete(buildApiUrl(`${base(chatId)}/${id}`)),
    onSuccess: invalidate,
  });
  return { add, setStatus, remove };
}
