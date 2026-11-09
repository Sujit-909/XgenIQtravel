// Shared input and link rules. No credentials or employee records live here.
export const ASSISTANT_MAX_MESSAGE = 2000;
export function cleanAssistantMessage(value) {
  if (typeof value !== 'string') throw new Error('Enter a message');
  const text = value.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  if (!text || text.length > ASSISTANT_MAX_MESSAGE) throw new Error(`Enter a message between 1 and ${ASSISTANT_MAX_MESSAGE} characters`);
  return text;
}
export function containsCredentials(text) {
  return /\b(?:password|passwd|pwd|api[_ -]?key|access[_ -]?token|token|client[_ -]?secret|secret|authorization)\s*(?:[:=]|\bis\b)\s*\S+/i.test(text) || /\bBearer\s+\S+/i.test(text) || /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{15,})\b/.test(text) || /-----BEGIN [\w ]*PRIVATE KEY-----/.test(text) || /\b[a-f\d]{40,}\b/i.test(text) || /\beyJ[A-Za-z\d_-]{20,}\.[A-Za-z\d_-]+/.test(text);
}
export function containsPrivateContent(text) {
  return /\b(?:confidential|internal.only|payroll|salary|salaries|bank account|account number|credit card|aadhaar|passport number|medical record|customer list|trade secret|employee record)\b/i.test(text) || /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(text) || (text.match(/(?:\+?\d[\d -]{8,}\d)/g) || []).some((v) => v.replace(/\D/g, '').length >= 10) || /\b(?:BT|SRV|EMP|EXP|ER|BK)[-_]?\d{3,}(?:-\d+)?\b/i.test(text) || /(?:₹|\$|INR\s*)\s*\d[\d,.]*/i.test(text);
}
export function assistantLink(value) {
  if (typeof value !== 'string' || /[\x00-\x20\\]/.test(value)) return null;
  if (/^\/(?:policy|trips|expenses|bookings|refunds|help)(?:[/?#]|$)/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname.endsWith('serpapi.com') || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    if ([...url.searchParams.keys()].some((key) => /api.?key|token|secret|authorization/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}
