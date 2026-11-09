import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { json } from '../db';
import { secret } from '../crypto';
import { bad, HttpError, nowIso } from '../util';
import { inr } from '../format';
import { cleanAssistantMessage, containsCredentials, containsPrivateContent } from '../assistant-safety';
import { fetchGemini } from '../providers/gemini';
import { travelAgent } from './travel-agent';

const TTL = 10 * 60000;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const running = new Map(); const completed = new Map();
const INSTRUCTIONS = 'Provide helpful general workplace assistance: professional writing, travel planning, general expense procedures, HR concepts, IT troubleshooting and research. You have no company documents or employee records. Never invent official company policies, employee details, approval statuses or financial records. Do not claim to execute or approve business actions. Explain that company-specific decisions require official sources and authorized workflows. Format the answer in concise Markdown. Employee question:\n';
const ref = (title, url) => ({ title, url, index: 0, snippet: '' });
const plain = (value) => String(value ?? '').replace(/[\r\n|]/g, ' ');
function identity(user, session) {
  if (!user?.id || typeof session !== 'string' || session.length < 20) throw new HttpError(401, 'Please sign in to continue');
  return createHmac('sha256', secret()).update(`${user.id}:${session}`).digest('hex');
}
function seal(value, session) {
  const key = createHmac('sha256', secret()).update(session).digest(); const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64');
}
function unseal(value, session) {
  if (!value) return null;
  try { const bytes = Buffer.from(value, 'base64'); const cipher = createDecipheriv('aes-256-gcm', createHmac('sha256', secret()).update(session).digest(), bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString('utf8'); }
  catch { return null; }
}
function limit(db, user, external = false) {
  const now = Date.now();
  const buckets = external ? [[`gemini:${user.id}`, Math.floor(now / 60000), 6], [`daily:${user.id}`, Math.floor(now / 86400000), 100], ['gemini:all', Math.floor(now / 60000), 60]] : [[`chat:${user.id}`, Math.floor(now / 60000), 20]];
  db.tx(() => {
    db.run('DELETE FROM employee_assistant_limits WHERE expires_at<?', now);
    for (const [bucket, window, max] of buckets) {
      const count = db.get('SELECT count FROM employee_assistant_limits WHERE bucket=? AND window=?', bucket, window)?.count || 0;
      if (count >= max) throw new HttpError(429, 'Assistant request limit reached. Please wait and try again later.');
      db.run('INSERT INTO employee_assistant_limits(bucket,window,count,expires_at) VALUES(?,?,1,?) ON CONFLICT(bucket,window) DO UPDATE SET count=count+1', bucket, window, now + (bucket.startsWith('daily:') ? 86400000 : 60000));
    }
  });
}
function createConversation(db, user, scope) {
  const id = randomUUID();
  db.run('INSERT INTO employee_assistant_conversations(id,user_id,session_hash,expires_at) VALUES(?,?,?,?)', id, user.id, scope, new Date(Date.now() + TTL).toISOString());
  return db.get('SELECT * FROM employee_assistant_conversations WHERE id=?', id);
}
function context(db, user, scope, token) {
  if (!token) return { row: createConversation(db, user, scope), reset: false };
  if (typeof token !== 'string' || !UUID.test(token)) throw bad('Invalid conversation handle. Start a new conversation.');
  const row = db.get('SELECT * FROM employee_assistant_conversations WHERE id=? AND user_id=? AND session_hash=?', token, user.id, scope);
  if (!row) throw new HttpError(404, 'Conversation not found for this sign-in session. Start a new conversation.');
  if (row.expires_at <= nowIso()) { db.run('DELETE FROM employee_assistant_conversations WHERE id=?', row.id); return { row: createConversation(db, user, scope), reset: true }; }
  return { row, reset: false };
}
function localTopic(message, scope, previous) {
  const t = message.toLowerCase();
  if (/\b(approve|reject|cancel|reserve|pay|submit|create|book|transfer)\b/.test(t) && /\b(leave|expense|claim|trip|booking|flight|hotel|payment|reimbursement|it|request)\b/.test(t)) return 'workflow';
  const official = /\b(my|our|company|geniq|xgeniq|official|internal)\b/.test(t);
  if ((official || scope !== 'general') && /\b(policy|policies|claim limit|travel limit|allowance)\b/.test(t)) return /\b(hr|leave|annual|sick|payroll)\b/.test(t) ? 'company' : 'policy';
  if ((official || scope === 'company') && /\b(trips?|travel requests?|approval|bookings?)\b/.test(t)) return 'trips';
  if ((official || scope === 'company') && /\b(expenses?|reimbursements?|claims?|payments?|paid)\b/.test(t)) return 'expenses';
  if (/\b(trips?|reimbursements?|expenses?|payments?|bookings?|leave|employees?)\b/.test(t) && /\b(status|records?|balance|history|show|list|whose)\b/.test(t)) return 'company';
  if (scope === 'company' || (official && /\b(hr|leave|entitlement|balance|employee|status|records?)\b/.test(t))) return 'company';
  return scope === 'auto' && previous ? previous : null;
}
function internalAnswer(db, user, topic, message) {
  if (topic === 'workflow') return { answer: 'I can explain a process, but I cannot create, submit, approve, reject, pay for or cancel business transactions. Use the existing authorized workflow below.', references: [ref('Create or review travel requests', '/trips'), ref('Expense reports', '/expenses'), ref('Bookings and cancellation workflow', '/bookings')], related_questions: ['What is our travel policy?', 'Show my upcoming trips'], answer_kind: 'workflow' };
  if (topic === 'trips') {
    const rows = db.all('SELECT id,trip_no,dest_city,dep_date,ret_date,status FROM trips WHERE traveller_id=? ORDER BY dep_date DESC LIMIT 10', user.id);
    return { answer: rows.length ? `## Your travel requests\n\nThese are current records from GENIQ, not AI predictions.\n\n| Request | Destination | Departure | Return | Status |\n| --- | --- | --- | --- | --- |\n${rows.map((r) => `| ${plain(r.trip_no)} | ${plain(r.dest_city)} | ${r.dep_date} | ${r.ret_date} | ${plain(r.status)} |`).join('\n')}` : 'No travel requests are recorded for you. Use My Trips to create a request through the authorized workflow.', references: [ref('My Trips — complete records', '/trips')], related_questions: ['Show my reimbursement status', 'What is our travel policy?'], answer_kind: 'internal' };
  }
  if (topic === 'expenses') {
    const rows = db.all('SELECT e.id,e.report_no,e.status,r.status payment_status,r.payable_amount FROM expense_reports e LEFT JOIN reimbursements r ON r.report_id=e.id WHERE e.user_id=? ORDER BY e.id DESC LIMIT 10', user.id);
    return { answer: rows.length ? `## Your expense records\n\nRead-only data from GENIQ.\n\n| Report | Report status | Payment status | Recorded payable |\n| --- | --- | --- | --- |\n${rows.map((r) => `| ${plain(r.report_no)} | ${plain(r.status)} | ${plain(r.payment_status || 'Not recorded')} | ${r.payable_amount === null ? 'Not recorded' : inr(r.payable_amount)} |`).join('\n')}` : 'No expense reports are recorded for you. Open Expense Reports to use the existing reimbursement workflow.', references: [ref('My expense reports', '/expenses?scope=mine')], related_questions: ['What is our travel policy?', 'Show my travel requests'], answer_kind: 'internal' };
  }
  if (topic === 'policy') {
    const type = /hotel|stay/i.test(message) ? 'Hotel' : /flight|airfare|cabin/i.test(message) ? 'Flight' : null;
    const rules = db.all(`SELECT rule_no,name,description,conditions FROM policy_rules WHERE status='Active' ${type ? 'AND type=?' : ''} ORDER BY rule_no LIMIT 20`, ...(type ? [type] : [])).filter((r) => { const c = json(r.conditions, {}); return !c.grades || c.grades.includes(user.grade); });
    const lines = rules.map((r) => {
      const c = json(r.conditions, {}); const terms = [];
      if (c.travelType) terms.push(`Travel type: ${plain(c.travelType)}`);
      if (c.tier) terms.push(`City tier: ${plain(c.tier)}`);
      if (c.countries) terms.push(`Countries: ${c.countries.map(plain).join(', ')}`);
      if (typeof c.maxFare === 'number') terms.push(`Fare limit: ${inr(c.maxFare)}`);
      if (typeof c.maxPerNight === 'number') terms.push(`Hotel limit: ${inr(c.maxPerNight)} per night`);
      if (typeof c.maxStar === 'number') terms.push(`Maximum hotel class: ${c.maxStar} stars`);
      if (Array.isArray(c.cabin)) terms.push(`Permitted cabin: ${c.cabin.map(plain).join(', ')}`);
      if (typeof c.advanceDays === 'number') terms.push(`Minimum booking lead time: ${c.advanceDays} days`);
      return `### ${plain(r.rule_no)} — ${plain(r.name)}\n\n${plain(r.description)}${terms.length ? `\n\n${terms.map((v) => `- ${v}`).join('\n')}` : ''}`;
    });
    return { answer: rules.length ? `## Active travel policy records\n\nThese are approved active rules available in GENIQ. Applicability depends on the stated travel type, destination and employee grade; use the policy workflow for a final decision.\n\n${lines.join('\n\n')}\n\nI cannot infer other entitlements or a universal claim limit from these records.` : 'No matching active policy rule is available in GENIQ. Ask the policy owner for an official answer.', references: [ref('Approved travel policy records', '/policy')], related_questions: ['Show my travel requests', 'Show my reimbursement status'], answer_kind: 'internal' };
  }
  return { answer: 'No approved HR or leave documents are connected to this application. I cannot verify company-specific entitlements, balances, payroll, employee records or unsupported policies. Ask HR or your authorized policy owner for an official answer. You can select General guidance for explanations of workplace concepts without private details.', references: [ref('Available approved travel policies', '/policy'), ref('Help and support', '/help')], related_questions: ['What is our travel policy?'], answer_kind: 'internal' };
}
export async function employeeChat(db, user, session, input) {
  const scope = identity(user, session);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('Invalid assistant request');
  if (input.subsequent_request_token !== undefined) throw bad('Use the conversation handle issued by GENIQ, not a provider token');
  const requestId = input.request_id || randomUUID();
  if (!UUID.test(requestId)) throw bad('Invalid request ID');
  const mode = input.scope || 'auto'; if (!['auto', 'company', 'general'].includes(mode)) throw bad('Select a supported assistance mode');
  const action = input.action || 'message'; if (!['message', 'new_conversation', 'travel_tool'].includes(action)) throw bad('Invalid assistant action');
  if (action === 'travel_tool' && (!input.travel || typeof input.travel !== 'object' || Array.isArray(input.travel))) throw bad('Select a supported travel action');
  let message = '';
  if (action === 'message') { try { message = cleanAssistantMessage(input.message); } catch (e) { throw bad(e.message); } }
  if (containsCredentials(message) || (process.env.SERPAPI_API_KEY && message.includes(process.env.SERPAPI_API_KEY))) throw new HttpError(422, 'Do not include passwords, API keys or access tokens. Remove credentials and try again.');
  const hash = createHash('sha256').update(JSON.stringify({ action, mode, message, travel: input.travel || null, conversation: input.conversation_token || '' })).digest('hex');
  const key = `${scope}:${requestId}`;
  for (const [k, value] of completed) if (value.until < Date.now()) completed.delete(k);
  if (completed.has(key)) { const item = completed.get(key); if (item.hash !== hash) throw new HttpError(409, 'This request ID was already used for another message'); return item.result; }
  if (running.has(key)) { const item = running.get(key); if (item.hash !== hash) throw new HttpError(409, 'This request ID is already in use'); return item.promise; }
  const promise = Promise.resolve().then(async () => {
    limit(db, user);
    db.run('DELETE FROM employee_assistant_conversations WHERE expires_at<? AND lease_until<? AND id!=?', new Date(Date.now() - TTL).toISOString(), Date.now(), typeof input.conversation_token === 'string' ? input.conversation_token : '');
    if (action === 'new_conversation') {
      if (input.conversation_token) context(db, user, scope, input.conversation_token);
      db.run('DELETE FROM employee_assistant_conversations WHERE user_id=? AND session_hash=?', user.id, scope);
      for (const k of completed.keys()) if (k.startsWith(`${scope}:`)) completed.delete(k);
      const row = createConversation(db, user, scope);
      return { answer: '', references: [], related_questions: [], conversation_token: row.id, conversation_reset: true, answer_kind: 'new' };
    }
    let { row, reset } = context(db, user, scope, input.conversation_token);
    const submittedPlan = action === 'travel_tool' && input.travel?.tool === 'submitTravelRequest' && db.get('SELECT trip_id FROM assistant_travel_plans WHERE conversation_id=? AND user_id=? AND session_hash=? AND trip_id IS NOT NULL', row.id, user.id, scope);
    if (row.last_request_id === requestId && !submittedPlan) throw new HttpError(409, 'This message was already processed. Start a new message if you need to ask again.');
    const leaseUntil = Date.now() + 60000;
    const lease = db.run('UPDATE employee_assistant_conversations SET lease_until=? WHERE id=? AND lease_until<?', leaseUntil, row.id, Date.now());
    if (!lease.changes) throw new HttpError(409, 'A response is already in progress for this conversation. Please wait.');
    try {
      const privateContent = containsPrivateContent(message);
      const topic = localTopic(message, mode, row.topic);
      let result; let encrypted = null;
      const travelResult = await travelAgent(db, user, scope, row.id, message, action === 'travel_tool' ? input.travel : null);
      if (travelResult) {
        result = travelResult;
      } else if (topic || privateContent) {
        result = privateContent && !topic ? { answer: 'This message may contain personal, financial or confidential information. It has not been sent to an external AI service. Remove private details, or use Company information for authorized internal records.', references: [ref('Help and support', '/help')], related_questions: [], answer_kind: 'private' } : internalAnswer(db, user, topic, message);
      } else {
        limit(db, user, true);
        let token = unseal(row.encrypted_token, session);
        if (row.encrypted_token && !token) reset = true;
        if (row.turns > 0 && !token) reset = true;
        const deadline = Date.now() + 55000;
        try { result = await fetchGemini(INSTRUCTIONS + message, token, { timeoutMs: Math.min(40000, deadline - Date.now()) }); }
        catch (error) {
          if (error.status !== 410 || !token) throw error;
          db.run('UPDATE employee_assistant_conversations SET encrypted_token=NULL WHERE id=?', row.id);
          limit(db, user, true);
          result = await fetchGemini(INSTRUCTIONS + message, null, { timeoutMs: Math.max(1, Math.min(40000, deadline - Date.now())) }); reset = true;
        }
        encrypted = result.token ? seal(result.token, session) : null;
        result = { answer: result.answer, references: result.references, related_questions: result.related_questions, answer_kind: 'general' };
      }
      const updated = db.run('UPDATE employee_assistant_conversations SET encrypted_token=?,topic=?,expires_at=?,lease_until=0,last_request_id=?,turns=turns+1 WHERE id=? AND user_id=? AND session_hash=?', encrypted, topic || (privateContent ? 'company' : null), new Date(Date.now() + TTL).toISOString(), requestId, row.id, user.id, scope);
      if (!updated.changes) throw new HttpError(409, 'This conversation was cleared. Please start a new chat.');
      return { ...result, conversation_token: row.id, conversation_reset: reset, expires_at: new Date(Date.now() + TTL).toISOString() };
    } finally { db.run('UPDATE employee_assistant_conversations SET lease_until=0 WHERE id=? AND lease_until=?', row.id, leaseUntil); }
  }).then((result) => { if (completed.size >= 300) completed.delete(completed.keys().next().value); const entry = { hash, result, until: Date.now() + 120000 }; completed.set(key, entry); const cleanup = setTimeout(() => { if (completed.get(key) === entry) completed.delete(key); }, 120000); cleanup.unref?.(); return result; }).finally(() => running.delete(key));
  running.set(key, { hash, promise }); return promise;
}
