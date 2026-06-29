import { Injectable } from '@nestjs/common';

import {
  resolveModelCredential,
  requireModelCredential,
  type ModelClient,
  type ModelCredentialResolver,
} from './model-client';
import { createOpenAIModelClient } from './openai-model-client';

@Injectable()
export class ModelsService {
  resolveModelCredential(
    userId: string,
    resolveCredential?: ModelCredentialResolver,
  ): Promise<string> {
    return resolveModelCredential(userId, resolveCredential);
  }

  requireModelCredential(
    credential: string | null | undefined,
    userId?: string,
  ): string {
    return requireModelCredential(credential, userId);
  }

  createOpenAIClient(apiKey: string, model?: string): ModelClient {
    return createOpenAIModelClient(apiKey, model);
  }
}
