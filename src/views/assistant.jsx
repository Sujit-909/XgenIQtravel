'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge, Btn, Icon, Select, useApi } from '@/components/ui';
import AssistantMarkdown from '@/components/AssistantMarkdown';
import TravelAgentCard from '@/components/TravelAgentCard';
import { ASSISTANT_MAX_MESSAGE, assistantLink } from '@/lib/assistant-safety';

const TOPICS = [
  ['Writing Assistant', 'edit', 'Draft a concise professional email requesting a meeting.', 'general'],
  ['IT Help', 'settings', 'How can I troubleshoot an unstable Wi-Fi connection?', 'general'],
  ['Travel Assistance', 'plane', 'Help me plan a business trip with flights and a hotel.', 'auto'],
  ['Policy & Guidelines', 'shield', 'What is our hotel policy?', 'company'],
  ['Reimbursement', 'rupee', 'Show my reimbursement status', 'company'],
];
function Sources({ items }) {
  return items?.length ? <div className="employee-sources"><b className="small">Sources</b><ul>{items.map((source, i) => {
    const url = assistantLink(source.url); if (!url) return null;
    return <li key={`${i}-${url}`}>{url.startsWith('/') ? <Link href={url}>{source.title}</Link> : <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{source.title}</a>}</li>;
  })}</ul></div> : null;
}
export function AssistantView({ user, initial = [] }) {
  const api = useApi(); const [messages, setMessages] = useState(initial); const [text, setText] = useState(''); const [scope, setScope] = useState('auto');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [copied, setCopied] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [history, setHistory] = useState([]); const [selected, setSelected] = useState(null); const [filter, setFilter] = useState('all'); const [drawer, setDrawer] = useState(false); const [all, setAll] = useState(false); const started = useRef(null); const successful = useRef(null);
  const followLatest = useRef(true);
  const end = useRef(null); const input = useRef(null); const conversation = useRef(null); const lock = useRef(false); const retry = useRef(null); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const log = end.current?.parentElement; if (log && followLatest.current && (messages.length || busy)) log.scrollTo?.({ top: log.scrollHeight, behavior: 'auto' }); }, [messages, busy]);
  useEffect(() => {
    if (!drawer) return;
    const panel = document.getElementById('employee-history');
    const previous = document.activeElement;
    const controls = () => [...panel.querySelectorAll('button:not(:disabled), a[href]')].filter((el) => el.getClientRects().length);
    controls()[0]?.focus();
    const handle = (event) => {
      if (event.key === 'Escape') setDrawer(false);
      if (event.key !== 'Tab') return;
      const items = controls(); const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); previous?.focus(); };
  }, [drawer]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(''), 2000); return () => clearTimeout(timer); }, [copied]);
  const perform = async (payload, userId) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    retry.current = { payload, userId };
    try {
      const result = await api('POST', '/employee-assistant/chat', payload, { refresh: false, silent: true });
      if (!mounted.current) return;
      if (!result.ok) { setError(result.error || 'The assistant could not respond. Please retry.'); return; }
      const data = result.data; conversation.current = data.conversation_token; retry.current = null;
      if (payload.message) successful.current = { payload, userId };
      if (payload.action === 'new_conversation') { if (messages.length) setHistory((old) => [...old, { id: crypto.randomUUID(), messages, at: started.current, title: messages.find((m) => m.role === 'user')?.text || 'Conversation', pinned: false }]); started.current = null; successful.current = null; setSelected(null); setMessages([]); setText(''); setNotice('New conversation started. Previous chat context has been cleared.'); }
      else {
        setMessages((old) => [...old, { id: crypto.randomUUID(), role: 'assistant', text: data.answer, references: data.references, questions: data.related_questions, kind: data.answer_kind, travel: data.travel }]);
        if (data.conversation_reset) setNotice('The previous conversation expired. This answer starts with fresh context.');
      }
    } finally { lock.current = false; if (mounted.current) { setBusy(false); input.current?.focus(); } }
  };
  const send = (question = text, mode = scope) => {
    const message = question.trim(); if (!message || lock.current) return;
    if (selected) return; if (!started.current) started.current = new Date().toISOString();
    followLatest.current = true;
    const id = crypto.randomUUID(); setText('');
    setMessages((old) => [...old, { id, role: 'user', text: message }]);
    perform({ message, scope: mode, conversation_token: conversation.current || undefined, request_id: crypto.randomUUID() }, id);
  };
  const newConversation = () => perform({ action: 'new_conversation', request_id: crypto.randomUUID() });
  const travelTool = (plan, tool, args) => {
    if (lock.current || selected) return;
    followLatest.current = true;
    setMessages(old => [...old, {id:crypto.randomUUID(),role:'user',text:tool === 'submitTravelRequest' ? 'I confirm: submit this travel request for approval.' : tool.replace(/([A-Z])/g,' $1').trim()}]);
    perform({action:'travel_tool',travel:{plan_id:plan.plan_id,version:plan.version,tool,args},conversation_token:conversation.current,request_id:crypto.randomUUID()});
  };
  const copy = async (message) => {
    try { await navigator.clipboard.writeText(message.text); setCopied(message.id); }
    catch { setNotice('Clipboard access is unavailable. Select the response text to copy it.'); }
  };
  const displayed = selected ? history.find((h) => h.id === selected)?.messages || [] : messages;
  const recent = history.filter((h) => filter === 'all' || (filter === 'pinned' && h.pinned)).slice().reverse();
  const latestTravel = [...messages].reverse().find(message => message.travel)?.travel;
  const lastAnswer = [...displayed].reverse().find((message) => message.role === 'assistant');
  return <div className="employee-assistant">
    <div className="page-head"><div className="row"><span className="ico-box"><Icon name="bot" size={24} /></span><div><h1>GENIQ Employee Assistant</h1><p>Your AI workplace companion for travel, policy, IT support, and daily work help.</p></div></div><div className="row wrap"><Link href="/trips/new" className="btn outline">New Trip Request</Link><Link href="/expenses/new" className="btn outline">New Expense Report</Link></div></div>
    <button className="btn outline employee-history-toggle" onClick={() => setDrawer(!drawer)} aria-expanded={drawer} aria-controls="employee-history"><Icon name="list" size={16} />Conversations</button>
    <div className={`employee-workspace ${collapsed ? 'history-collapsed' : ''}`}>
    <aside id="employee-history" className={`employee-history ${drawer ? 'is-open' : ''}`} aria-label="Conversation history">
      <div className="row between employee-history-heading"><b>Your workspace</b><button className="icon-btn employee-history-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand conversations' : 'Collapse conversations'} aria-expanded={!collapsed} aria-controls="employee-history"><Icon name={collapsed ? 'chevRight' : 'chevLeft'} size={16}/></button><button className="icon-btn employee-drawer-close" onClick={() => setDrawer(false)} aria-label="Close conversations"><Icon name="x" /></button></div>
      <Btn className="btn employee-new-conversation" icon="plus" aria-label="New conversation" title="New conversation" disabled={busy} onClick={() => { setDrawer(false); newConversation(); }}><span>New conversation</span></Btn>
      <nav aria-label="Conversation filters">{[['all','list','All Conversations'],['pinned','star','Pinned'],['shared','users','Shared with Me']].map(([key,icon,label]) => <button key={key} className={filter === key ? 'on' : ''} title={label} aria-label={label} aria-pressed={filter === key} onClick={() => setFilter(key)}><Icon name={icon} size={16} /><span>{label}</span></button>)}</nav>
      <h2>Recent Conversations</h2><div className="employee-history-list">
      {filter === 'all' && messages.length > 0 && <button className={`employee-history-item ${!selected ? 'on' : ''}`} title="Current conversation" aria-label="Current conversation" disabled={busy} onClick={() => { setSelected(null); setDrawer(false); }}><Icon name="bot" size={15} /><span><b>{messages.find((m) => m.role === 'user')?.text || 'Current conversation'}</b><small>Current conversation</small></span></button>}
      {(all ? recent : recent.slice(0,5)).map((h) => <div className="employee-history-entry" key={h.id}><button className={`employee-history-item ${selected === h.id ? 'on' : ''}`} title={h.title} aria-label={h.title} disabled={busy} onClick={() => { setSelected(h.id); setDrawer(false); }}><Icon name="file" size={15}/><span><b>{h.title}</b><time dateTime={h.at}>{h.at ? new Date(h.at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Earlier this session'}</time></span></button><button className="icon-btn" aria-label={h.pinned ? 'Unpin conversation' : 'Pin conversation'} aria-pressed={h.pinned} onClick={() => setHistory((old) => old.map((item) => item.id === h.id ? {...item,pinned:!item.pinned} : item))}><Icon name="star" size={13} /></button></div>)}
      {!recent.length && (filter !== 'all' || !messages.length) && <p className="employee-history-empty">{filter === 'shared' ? 'Conversation sharing is not available.' : filter === 'pinned' ? 'No pinned conversations yet.' : 'Your conversations will appear here as you chat.'}</p>}
      </div><button className="employee-view-all" onClick={() => { setFilter('all'); setAll(!all); }}>{all ? 'Show Recent Conversations' : 'View All Conversations'}<Icon name="chevRight" size={14} /></button>
      <div className="employee-quick-help"><span className="ico-box"><Icon name="bot" size={22} /></span><h3>A little help, a lot easier.</h3><p>From a first draft to your next trip, GENIQ is here to help.</p><button onClick={() => { setSelected(null); setText('What can you help me with?'); setDrawer(false); input.current?.focus(); }}>Explore what I can do <Icon name="chevRight" size={13} /></button></div><small className="muted">History is available on this page only.</small>
    </aside><div className="employee-main">

      <div className="employee-services">{[0,2,3,4,1].map((index) => { const [label,icon,question,mode] = TOPICS[index]; return <button className="employee-service" disabled={busy || !!selected} key={label} onClick={() => { setText(question); setScope(mode); input.current?.focus(); }}><span className="employee-service-icon"><Icon name={icon} size={20}/></span><h3>{label}</h3><p>{['Emails, notes and professional drafts.','Access, VPN, software and common issues.','Bookings, approvals and travel policy.',"Company policies, DOs and DON'Ts.",'Claims, eligibility and documentation.'][index]}</p><Icon name="chevRight" className="employee-service-arrow" size={15}/></button>; })}</div>
    <section className="card employee-chat-panel" aria-label="Employee assistant chat">
      <div className="employee-chat-log" onScroll={(e) => { const log = e.currentTarget; followLatest.current = log.scrollHeight - log.scrollTop - log.clientHeight < 80; }} role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation">
        {!displayed.length && <div className="employee-chat-empty"><div className="employee-empty-icon"><Icon name="bot" size={32}/><span>&#10022;</span></div><h2>Start a conversation.</h2><p>Ask anything or choose a topic above to get started.</p></div>}
        {displayed.map((message) => <article key={message.id} className={`employee-message ${message.role === 'user' ? 'employee-user' : 'employee-answer'}`} aria-label={message.role === 'user' ? 'Your message' : 'Assistant response'}>
          <div className="employee-message-head"><span className="row small"><Icon name={message.role === 'user' ? 'user' : 'bot'} size={16} /><b>{message.role === 'user' ? 'You' : 'GENIQ'}</b>{message.role === 'assistant' && <Badge tone={message.kind === 'general' ? 'blue' : 'gray'}>{message.kind === 'travel' ? 'Travel planning' : message.kind === 'general' ? 'General AI guidance' : message.kind === 'workflow' ? 'Authorized workflow required' : message.kind === 'private' ? 'Kept private' : 'Internal information'}</Badge>}</span>{message.role === 'assistant' && <button className="btn outline sm" onClick={() => copy(message)} aria-label="Copy response"><Icon name="copy" size={14} />{copied === message.id ? 'Copied' : 'Copy'}</button>}</div>
          {message.role === 'user' ? <p className="employee-user-text">{message.text}</p> : <><AssistantMarkdown text={message.text} />{message.kind === 'general' && <div className="employee-answer-note">General guidance from Gemini; this is not official company policy.</div>}<Sources items={message.references} />{message.travel && <TravelAgentCard plan={message.travel} active={!selected && message.travel === latestTravel} busy={busy} onTool={travelTool} />}{message === lastAnswer && message.kind !== 'travel' && !selected && successful.current && <button className="employee-retry" disabled={busy} onClick={() => { const item = successful.current; if (!item || lock.current) return; setMessages((old) => old.filter((m) => m.id !== message.id)); perform({...item.payload, request_id:crypto.randomUUID()}, item.userId); }}><Icon name="refresh" size={13}/>Retry response</button>}</>}
        </article>)}
        {busy && <div className="employee-thinking" role="status"><Icon name="refresh" size={16} /><span>GENIQ is preparing a response...</span></div>}
        <div ref={end} />
      </div>
      {notice && <div className="note employee-chat-notice" role="status">{notice}</div>}
      {error && <div className="err employee-chat-notice" role="alert"><div>{error}</div><div className="row wrap mt-sm"><Btn variant="outline" disabled={busy || !retry.current} onClick={() => { const item = retry.current; if (item) perform(item.payload, item.userId); }}>Retry</Btn>{retry.current?.payload.message && <Btn variant="outline" disabled={busy} onClick={() => { const item = retry.current; setText(item.payload.message); setMessages((old) => old.filter((m) => m.id !== item.userId)); retry.current = null; setError(''); input.current?.focus(); }}>Edit message</Btn>}<Btn variant="outline" disabled={busy} onClick={newConversation}>Start a new chat</Btn></div></div>}
      {selected && <div className="note employee-chat-notice">This earlier conversation is read-only. <button className="btn outline sm" onClick={() => setSelected(null)}>Return to current conversation</button></div>}<div className="employee-chat-compose" hidden={!!selected}>
        {lastAnswer?.questions?.length > 0 && !busy && <div className="employee-followups" aria-label="Suggested follow-up questions">{lastAnswer.questions.map((q) => <button className="pill" key={q} onClick={() => send(q)}>{q}</button>)}</div>}
        <form onSubmit={(e) => { e.preventDefault(); send(); }}><div className="row wrap employee-mode-row"><label className="f">Assistance mode<Select value={scope} disabled={busy} onChange={(e) => setScope(e.target.value)} options={[["auto", 'Automatic'], ['company', 'Company information'], ['general', 'General guidance']]} /></label><span className="small muted">Company records stay in GENIQ. General questions use external AI. Do not include passwords, private employee data or confidential business information.</span></div>
          <div className="employee-message-input"><button type="button" className="icon-btn" aria-label="Attachment availability" onClick={() => setNotice('Attachments are not supported by this assistant yet.')}><Icon name="paperclip" size={18}/></button><textarea ref={input} className="in" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} placeholder="Ask a question or request a draft..." maxLength={ASSISTANT_MAX_MESSAGE} aria-label="Message" aria-describedby="employee-message-hint" rows={2} /><Btn type="submit" busy={busy} disabled={!text.trim()} icon="send">Send</Btn></div><div id="employee-message-hint" className="small muted">Enter to send · Shift+Enter for a new line · {text.length}/{ASSISTANT_MAX_MESSAGE}. Messages are not saved to server history.</div>
        </form>
      </div>
    </section>
    </div></div>
  </div>;
}
