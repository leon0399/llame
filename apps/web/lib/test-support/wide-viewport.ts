/** Session details sit beside the transcript from this width (80rem). */
const WIDE_QUERY = "(min-width: 80rem)";

/**
 * Gives a story the desktop width where session details and the
 * finished-jobs panel dock beside the chat. The story workspace runs one
 * fixed browser viewport narrower than 80rem, and `useWideViewport` reads
 * `matchMedia`, so this answers that one query as matching. Call it from a
 * story's `beforeEach` and return what it returns, which restores the real
 * `matchMedia`.
 */
export function wideViewport(): () => void {
  const original = window.matchMedia;
  const matchMedia = original.bind(window);

  window.matchMedia = (query: string) => {
    const list = matchMedia(query);

    if (query !== WIDE_QUERY) return list;

    const wide: MediaQueryList = {
      media: list.media,
      matches: true,
      onchange: null,
      addListener: list.addListener.bind(list),
      removeListener: list.removeListener.bind(list),
      addEventListener: list.addEventListener.bind(list),
      removeEventListener: list.removeEventListener.bind(list),
      dispatchEvent: list.dispatchEvent.bind(list),
    };

    return wide;
  };

  return () => {
    window.matchMedia = original;
  };
}
