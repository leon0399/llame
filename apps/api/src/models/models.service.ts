import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  resolveModelCredential,
  requireModelCredential,
  type ModelClient,
  type ModelCredentialResolver,
} from './model-client';
import { createOpenAIModelClient } from './openai-model-client';

@Injectable()
export class ModelsService {
  constructor(private readonly config: ConfigService) {}

  resolveModelCredential(
    userId: string,
    resolveCredential?: ModelCredentialResolver,
  ): Promise<string> {
    return resolveModelCredential(
      userId,
      resolveCredential ?? (() => this.config.get<string>('OPENAI_API_KEY')),
    );
  }

  requireModelCredential(
    credential: string | null | undefined,
    userId?: string,
  ): string {
    return requireModelCredential(credential, userId);
  }

  createOpenAIClient(apiKey: string, model?: string): ModelClient {
    // `|| undefined` — .env.example ships these keys empty, and dotenv parses
    // `OPENAI_MODEL=` to '' rather than leaving the variable unset.
    return createOpenAIModelClient(
      apiKey,
      model ?? (this.config.get<string>('OPENAI_MODEL') || undefined),
      this.config.get<string>('OPENAI_BASE_URL') || undefined,
    );
  }
}
