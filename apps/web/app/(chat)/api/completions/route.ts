import { getModels } from '@/lib/ai/models';
import { LangChainAdapter } from 'ai';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const { prompt } = await req.json();

  const modelId = 'anthropic:claude-4-sonnet'
  const models = getModels();
  const model = models.find(m => m.id === modelId)?.instance;

  if (!model) {
    throw new Error(`Model not found: ${modelId}`);
  }

  const stream = await model.stream(prompt);

  return LangChainAdapter.toDataStreamResponse(stream);
}