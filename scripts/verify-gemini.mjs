// Explicit live verification using only public, non-sensitive example questions.
import nextEnv from '@next/env';
import { fetchGemini } from '../src/lib/providers/gemini.js';
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
try {
  const first = await fetchGemini('Give three general steps for troubleshooting an unstable home Wi-Fi connection. Do not use company-specific information.');
  console.log(JSON.stringify({ stage: 'first-question', answerCharacters: first.answer.length, references: first.references.length, relatedQuestions: first.related_questions.length, continuationAvailable: !!first.token }));
  if (!first.token) throw new Error('No continuation token was returned');
  const next = await fetchGemini('Turn those steps into a short checklist.', first.token);
  console.log(JSON.stringify({ stage: 'follow-up', answerCharacters: next.answer.length, references: next.references.length, relatedQuestions: next.related_questions.length, continuationAvailable: !!next.token }));
} catch (error) {
  console.log(JSON.stringify({ verification: 'failed', status: error.status || 500, message: 'Check Gemini engine availability, provider quota and server configuration.' }));
  process.exitCode = 1;
}
