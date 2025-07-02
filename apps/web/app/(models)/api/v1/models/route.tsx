import { NextRequest } from "next/server";

import { getModels } from "@/lib/ai/models";
import { auth } from "@/app/(auth)/auth";

export type ChatModelResponse = {
  id: string;
  name?: string;
  description?: string;
}

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
  }));

  return Response.json({
    data: response,
  })
}
