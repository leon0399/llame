export const SESSION_COOKIE_NAME = 'llame_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// last_seen_at write debounce (#68): a session touched within this window is
// validated read-only — keeps the per-request UPDATE off the hot path.
export const SESSION_TOUCH_DEBOUNCE_MS = 60 * 1000;
// Cookies must be Secure in production (SPEC §22.0), but a Secure cookie is dropped by
// the browser over local HTTP — silently breaking the cookie auth path in dev. Fail
// secure: Secure everywhere except an explicit NODE_ENV=development.
export const SESSION_COOKIE_SECURE = process.env.NODE_ENV !== 'development';
