// Stable router object (like the real next/navigation) - an unstable one makes effects that depend on it loop forever.
const router = { push: (u) => { window.location.href = u; }, replace: (u) => window.location.replace(u), refresh: () => window.__refresh && window.__refresh(), back: () => window.history.back() };
export const useRouter = () => router;
export const usePathname = () => window.location.pathname;
export const useSearchParams = () => new URLSearchParams(window.location.search);
export const useParams = () => ({});
export const redirect = (u) => { window.location.href = u; };
export const notFound = () => { throw new Error('not found'); };
