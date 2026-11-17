import type { ModelMessage } from '../chats/context-builder';
import type { ModelToolDeclaration } from '../db/schema';
import type { MediaSizing } from '../media/epoch-admission';
import { estimateModelRequestTokens } from './compaction';

export function automaticBoundaryThresholdReached(input: {
  readonly latestRequestContextTokens?: number;
  readonly system: string;
  readonly requestMessages: Array<ModelMessage>;
  readonly stepToolResults: Array<ModelMessage>;
  readonly toolDeclarations: ReadonlyArray<ModelToolDeclaration>;
  readonly stepToolResultMedia?: MediaSizing;
  readonly nextRequestMedia?: MediaSizing;
  readonly thresholdTokens: number;
}): boolean {
  if (input.latestRequestContextTokens !== undefined) {
    return (
      input.latestRequestContextTokens +
        estimateModelRequestTokens({
          messages: input.stepToolResults,
          toolDeclarations: [],
          ...(input.stepToolResultMedia !== undefined && {
            media: input.stepToolResultMedia,
          }),
        }) >=
      input.thresholdTokens
    );
  }

  return (
    estimateModelRequestTokens({
      system: input.system,
      messages: [...input.requestMessages, ...input.stepToolResults],
      toolDeclarations: input.toolDeclarations,
      ...(input.nextRequestMedia !== undefined && {
        media: input.nextRequestMedia,
      }),
    }) >= input.thresholdTokens
  );
}

export function compactionAttemptStarted(input: {
  readonly wakeCompaction: boolean;
  readonly startsAfterCompaction: boolean;
  readonly isWakeAttempt: boolean;
}): boolean {
  return (
    input.wakeCompaction ||
    (input.startsAfterCompaction && !input.isWakeAttempt)
  );
}
