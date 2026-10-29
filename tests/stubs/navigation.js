export const state = { path: '/dashboard', params: {}, search: new URLSearchParams() };
export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {} });
export const usePathname = () => state.path;
export const useParams = () => state.params;
export const useSearchParams = () => state.search;
export function redirect(to) { const e = new Error('NEXT_REDIRECT'); e.digest = `NEXT_REDIRECT;${to}`; e.to = to; throw e; }
export function notFound() { const e = new Error('NEXT_NOT_FOUND'); e.digest = 'NEXT_NOT_FOUND'; throw e; }
