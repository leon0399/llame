/**
 * The transcript's scroll container: the `Conversation` (`role="log"`)
 * root's first child — use-stick-to-bottom's scroller element. The ONE
 * declaration of that DOM contract; the inline script below and
 * chat-load-older.tsx's pin/observer logic both build on it (the e2e
 * history-pagination spec mirrors it as a literal, since the e2e island
 * does not import app code).
 */
export const CHAT_SCROLLER_SELECTOR = '[role="log"] > div';

/**
 * Inline <script> the chat page's SERVER component streams ahead of the
 * transcript markup (#187). React cannot scroll before it hydrates, so on a
 * hard reload the streamed SSR HTML would paint TOP-anchored for the whole
 * hydration window — several hundred ms of "wrong end of the chat" on a big
 * history. This pins the transcript's scroller (the Conversation `role="log"`
 * root's first child) to the bottom from the first streamed chunk onward,
 * re-pinning on every DOM mutation while the HTML streams in.
 *
 * Hand-off, whichever comes first:
 * - ChatLoadOlder's mount layout effect calls `window.__llameChatPinStop`
 *   once React owns scroll positioning;
 * - any user scroll intent (wheel / touch / keys) stops the pinning so a
 *   reader can scroll up even before hydration completes;
 * - a hard timeout, so a hydration failure can never leave a page that
 *   fights manual scrolling forever.
 */
export const PREHYDRATION_PIN_SCRIPT = `(() => {
  var stopped = false;
  var observer = new MutationObserver(pin);
  function stop() {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    removeEventListener("wheel", stop, true);
    removeEventListener("touchstart", stop, true);
    removeEventListener("keydown", stop, true);
  }
  function pin() {
    if (stopped) return;
    var scroller = document.querySelector(${JSON.stringify(CHAT_SCROLLER_SELECTOR)});
    if (!scroller) return;
    // Pre-hydration the scroller is overflow:visible (use-stick-to-bottom
    // only makes it scrollable from a client effect), so scrollTop writes
    // are no-ops until this applies the exact style the library will apply.
    if (getComputedStyle(scroller).overflow === "visible") {
      scroller.style.overflow = "auto";
    }
    scroller.scrollTop = scroller.scrollHeight;
  }
  addEventListener("wheel", stop, true);
  addEventListener("touchstart", stop, true);
  addEventListener("keydown", stop, true);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__llameChatPinStop = stop;
  setTimeout(stop, 10000);
  pin();
})()`;
