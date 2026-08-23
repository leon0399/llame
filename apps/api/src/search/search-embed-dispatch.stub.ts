import { type ChatEmbedDispatcher } from './search-embed-dispatch.service';

/**
 * A no-op {@link SearchEmbedDispatchService} for tests that construct services
 * directly (outside the Nest DI container) and don't exercise the search
 * embedding layer. Enqueue is best-effort and off-by-default in production, so
 * a no-op is behaviourally faithful for those suites.
 */
export function noopEmbedDispatch(): ChatEmbedDispatcher {
  return {
    enqueueChatEmbed: async () => {},
  };
}
