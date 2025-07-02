import ky from 'ky';
import { useQuery } from "@tanstack/react-query";
import { ChatModelResponse } from '@/app/(models)/api/v1/models/route';

export const fetchModels = () => ky.get<{ data: ChatModelResponse[]; }>("/api/v1/models")

export const useModelsQuery = () => useQuery({
  queryKey: ["models"],
  queryFn: async () => (await fetchModels().json()).data,
});
