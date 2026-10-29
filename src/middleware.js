import { NextResponse } from 'next/server';

// Light-weight gate: pages need a session cookie (the signature is verified by the server on every request).
const PUBLIC = ['/login', '/forgot-password', '/verify-otp', '/mfa'];
export function middleware(req) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!req.cookies.get('geniq_session')) {
    const url = req.nextUrl.clone(); url.pathname = '/login'; url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'] };
