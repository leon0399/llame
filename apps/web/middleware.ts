import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "llame_session";

export function middleware(req: NextRequest) {
  const { nextUrl } = req;
  const hasSessionCookie = req.cookies.has(SESSION_COOKIE_NAME);
  const isAuthRoute = [
    '/login',
    '/register',
  ].includes(nextUrl.pathname);

  if (isAuthRoute) {
    if (hasSessionCookie) {
      return NextResponse.redirect(new URL("/", nextUrl))
    }
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
export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/'],
  runtime: "nodejs",
};
