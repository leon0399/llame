import { NextRequest } from "next/server";

import { getModels } from "@/lib/ai/models";
import type { ChatModel as ServerChatModel } from "@/lib/ai/models"

import { auth } from "@/app/(auth)/auth";

export type ChatModelResponse = Omit<ServerChatModel, "instance">;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({
      error: "Unauthorized",
    }, { status: 401 });
  }

  const models = getModels();

  const response: ChatModelResponse[] = models.map(model => ({
    id: model.id,
    
    name: model.name,
    description: model.description,
    tags: model.tags,
    icon: model.icon,
    
    contextWindow: model.contextWindow,
    price: model.price,
    knowledgeCutoff: model.knowledgeCutoff,

    reasoning: model.reasoning,
    
    website: model.website,
    apiDocs: model.apiDocs,
    modelPage: model.modelPage,
    releasedAt: model.releasedAt,
  }));

  return Response.json({
    data: response,
  })
}
