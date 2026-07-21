import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './lib/session';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow API routes, Next internals, the login page, and any static asset
  // (anything with a file extension, e.g. /favicon.svg, /logo.png).
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname === '/login' ||
    /\.[^/]+$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Auth is decided ONLY by the signed session token. Plain cookies such as
  // st_auth/st_tutor are client-controlled and are never trusted here.
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip api, _next, and static files (paths containing a dot) entirely.
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
};
