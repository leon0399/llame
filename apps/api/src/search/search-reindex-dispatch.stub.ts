import { type ChatReindexDispatcher } from './search-reindex-dispatch.service';

/**
 * A no-op {@link SearchReindexDispatchService} for tests that construct services
 * directly (outside the Nest DI container) and don't exercise the search
 * projection. Enqueue is best-effort in production, so a no-op is behaviourally
 * faithful for those suites.
 */
export function noopReindexDispatch(): ChatReindexDispatcher {
  return {
    enqueueChatReindex: async () => {},
  };
}
