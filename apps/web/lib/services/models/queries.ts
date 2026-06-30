import { useQuery } from "@tanstack/react-query";
import { STATIC_CHAT_MODELS, type ChatModel } from "@/lib/ai/models";

export const fetchModels = async (): Promise<ChatModel[]> => STATIC_CHAT_MODELS;

export const useModelsQuery = () => useQuery({
  queryKey: ["models"],
  queryFn: fetchModels,
});
