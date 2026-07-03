import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "llame_session";

export function proxy(req: NextRequest) {
  const { nextUrl } = req;
  const hasSessionCookie = req.cookies.has(SESSION_COOKIE_NAME);
  const isAuthRoute = [
    '/login',
    '/register',
  ].includes(nextUrl.pathname);

  // Auth routes stay reachable regardless of cookie presence. We must NOT bounce
  // /login → / on cookie presence: a revoked/expired session leaves the httpOnly
  // cookie in place (JS/middleware can't clear it), so on a 401 the client redirects
  // to /login and a presence-only bounce would loop / ⇄ /login, trapping the user.
  // Redirecting an already-authenticated user away from /login is a UX nicety the
  // presence gate can't do safely; the login flow handles a valid session on submit.
  if (isAuthRoute) {
    return NextResponse.next();
  }

  if (!hasSessionCookie) {
    let callbackUrl = nextUrl.pathname;
    if (nextUrl.search) {
      callbackUrl += nextUrl.search;
    }

    const encodedCallbackUrl = encodeURIComponent(callbackUrl);

    return NextResponse.redirect(new URL(
      `/login?callbackUrl=${encodedCallbackUrl}`,
      nextUrl
    ));
  }

  return NextResponse.next();
}

// UX-only cookie presence gate. apps/api SessionAuthGuard is the data boundary.
// Page-only: exclude api/trpc and static/_next so non-page requests are never
// redirected to /login. Proxy always runs on the Node.js runtime (Next 16),
// so the former `runtime` option is gone.
export const config = {
  matcher: ['/((?!api|trpc|_next|.+\\.[\\w]+$).*)', '/'],
};
