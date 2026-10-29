export const ctx = { cookies: {} };
export async function cookies() { return { get: (n) => (ctx.cookies[n] ? { name: n, value: ctx.cookies[n] } : undefined) }; }
export async function headers() { return new Headers(); }
