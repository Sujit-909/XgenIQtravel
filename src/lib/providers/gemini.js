import { HttpError } from '../util';
import { assistantLink } from '../assistant-safety';

const list = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 20000) => typeof value === 'string' ? value.slice(0, max) : '';
function blocksToMarkdown(blocks, depth = 0) {
  if (depth > 5) return '';
  return list(blocks).slice(0, 150).map((block) => {
    if (block.type === 'heading') return `### ${text(block.snippet, 500)}`;
    if (block.type === 'code_block') return `\`\`\`${text(block.language, 30).replace(/[^\w+-]/g, '')}\n${text(block.code)}\n\`\`\``;
    if (block.type === 'table' && list(block.table).length) {
      const rows = block.table.slice(0, 100).map((row) => list(row).slice(0, 12).map((cell) => text(cell, 1000).replace(/\|/g, '\\|').replace(/\n/g, ' ')));
      return [rows[0], rows[0].map(() => '---'), ...rows.slice(1)].map((row) => `| ${row.join(' | ')} |`).join('\n');
    }
    if (block.type === 'list') return list(block.list).slice(0, 100).map((item) => `- ${text(item.snippet)}${item.list ? `\n${blocksToMarkdown([{ type: 'list', list: item.list }], depth + 1)}` : ''}`).join('\n');
    return text(block.snippet);
  }).filter(Boolean).join('\n\n');
}
export function parseGeminiResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(502, 'The assistant provider returned an invalid response. Please retry.');
  let answer = text(body.reconstructed_markdown) || blocksToMarkdown(body.text_blocks).slice(0, 20000);
  if (!answer.trim()) throw new HttpError(502, 'The assistant provider returned no answer. Please retry.');
  // Never echo a server credential even if an upstream response unexpectedly contains it.
  const key = process.env.SERPAPI_API_KEY;
  if (key) answer = answer.replaceAll(key, '[credential removed]');
  const references = list(body.references).slice(0, 30).map((ref, index) => ({ index: Number.isInteger(ref.index) ? ref.index : index, title: text(ref.title, 250) || 'Source', url: assistantLink(ref.link), snippet: text(ref.snippet, 500) })).filter((ref) => ref.url);
  const related_questions = list(body.related_questions).map((q) => text(typeof q === 'string' ? q : q.question, 300)).filter(Boolean).slice(0, 6);
  return { answer, references, related_questions, token: text(body.subsequent_request_token, 20000) || null };
}
export async function fetchGemini(question, token, { fetcher = fetch, timeoutMs = 40000 } = {}) {
  const key = process.env.SERPAPI_API_KEY;
  if (!key?.trim()) throw new HttpError(503, 'The employee assistant is not configured. Ask your administrator to configure SerpApi.');
  const url = new URL('https://serpapi.com/search.json');
  // Shared provider-cache hits could reuse a continuation token across identical questions.
  // GENIQ deduplicates requests per employee/session instead.
  url.search = new URLSearchParams({ engine: 'google_gemini', q: question, api_key: key, output: 'json', no_cache: 'true', ...(token ? { subsequent_request_token: token } : {}) }).toString();
  try {
    const response = await fetcher(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(Math.max(1, timeoutMs)) });
    if (response.status === 429) throw new HttpError(429, 'The assistant provider quota is temporarily exhausted. Please try again later.');
    if (token && [400, 404, 410].includes(response.status)) throw new HttpError(410, 'The assistant conversation has expired.');
    if (!response.ok) throw new HttpError(502, 'The assistant provider could not answer. Please retry.');
    const body = await response.json();
    if (body?.error || body?.search_metadata?.status === 'Error') {
      if (token && /token|expired|conversation|subsequent/i.test(String(body.error))) throw new HttpError(410, 'The assistant conversation has expired.');
      throw new HttpError(502, 'The assistant provider could not answer. Please retry.');
    }
    return parseGeminiResponse(body);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new HttpError(504, 'The assistant took too long to respond. Please retry.');
    throw new HttpError(502, 'Unable to reach the assistant provider. Please retry.');
  }
}
