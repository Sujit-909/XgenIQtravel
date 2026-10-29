// Server-component session helpers (use next/headers).
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getDb } from './db';
import { userFromToken, SESSION_COOKIE } from './services/auth';

export async function currentUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return userFromToken(getDb(), token);
}
export async function requireUser(roles) {
  const u = await currentUser();
  if (!u) redirect('/login');
  if (roles && !roles.includes(u.role)) redirect('/dashboard');
  return u;
}

// Run a service call inside a page; translate access / missing errors into Next.js responses.
export function guard(fn) {
  try { return fn(); } catch (e) { if (e?.status === 404 || e?.status === 403) notFound(); throw e; }
}
