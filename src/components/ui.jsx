'use client';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { toneOf } from '@/lib/format';

const P = {
  home: 'M3 10.5L12 3l9 7.5V21H3z M9 21v-7h6v7', plane: 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 0 1-3.4 0', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h8', calendar: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M16 2v4 M8 2v4 M3 10h18',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2', check: 'M20 6L9 17l-5-5', checkCircle: 'M22 11.1V12a10 10 0 1 1-5.9-9.1 M22 4L12 14l-3-3', x: 'M18 6L6 18 M6 6l12 12',
  alert: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01', chevDown: 'M6 9l6 6 6-6', chevRight: 'M9 18l6-6-6-6', chevLeft: 'M15 18l-6-6 6-6', plus: 'M12 5v14 M5 12h14',
  edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', trash: 'M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3', upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', chart: 'M18 20V10 M12 20V4 M6 20v-6', briefcase: 'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16',
  card: 'M21 4H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z M1 10h22', building: 'M3 21h18 M5 21V7l8-4v18 M19 21V11l-6-4 M9 9v.01 M9 12v.01 M9 15v.01 M9 18v.01',
  pin: 'M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6', send: 'M22 2L11 13 M22 2l-7 20-4-9-9-4z', bot: 'M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z M12 8V4 M9 13v.01 M15 13v.01 M9 17h6',
  rupee: 'M6 4h12 M6 9h12 M6 4c6 0 8 2 8 5s-3 5-8 5l7 6', refresh: 'M23 4v6h-6 M1 20v-6h6 M3.5 9a9 9 0 0 1 14.9-3.4L23 10 M1 14l4.6 4.4A9 9 0 0 0 20.5 15', filter: 'M22 3H2l8 9.5V19l4 2v-8.5z',
  car: 'M5 17h14 M5 17a2 2 0 1 0 4 0 M15 17a2 2 0 1 0 4 0 M3 13l2-6h14l2 6v4h-2 M3 13h18', bed: 'M3 18V6 M3 12h18v6 M21 12V9a2 2 0 0 0-2-2h-8v5', bus: 'M4 16V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10 M4 16h16 M4 11h16 M7 19v-3 M17 19v-3',
  train: 'M6 3h12a2 2 0 0 1 2 2v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2z M4 11h16 M8 21l2-3 M16 21l-2-3', globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01', lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 10 0v4',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01', logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  trophy: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18 M4 22h16 M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22 M14 14.7V17c0 .6.5 1 1 1.2 1.1.6 2 2 2 3.8 M18 2H6v7a6 6 0 0 0 12 0z',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1', more: 'M12 12h.01 M19 12h.01 M5 12h.01', menu: 'M3 12h18 M3 6h18 M3 18h18',
  paperclip: 'M21.4 11l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5', star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3-6.2 3.3L7 14.2 2 9.3l6.9-1z', power: 'M18.4 6.6a9 9 0 1 1-12.8 0 M12 2v10',
  play: 'M5 3l14 9-14 9z', info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01', hourglass: 'M6 2h12 M6 22h12 M6 2v4a6 6 0 0 0 12 0V2 M6 22v-4a6 6 0 0 1 12 0v4', heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7', receipt: 'M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2z M8 8h8 M8 12h8', gift: 'M20 12v10H4V12 M2 7h20v5H2z M12 22V7 M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
};
export function Icon({ name, size = 18, className = '', style }) {
  const d = P[name] || P.info;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">{d.split(' M').map((seg, i) => <path key={i} d={i ? `M${seg}` : seg} />)}</svg>;
}
export function Logo({ size = 22 }) {
  return <span className="brand-wordmark" style={{ fontSize: size, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.2, whiteSpace: 'nowrap' }}>XgenIQ</span>;
}

export const Badge = ({ children, tone }) => <span className={`badge t-${tone || toneOf(children)}`}>{children}</span>;
export function Avatar({ name = '', size = '', tone = '', src }) {
  const [failed, setFailed] = useState(null);
  return <span className={`avatar ${size} ${tone}`}>{src && failed !== src ? <img src={src} alt={`${name}'s profile photo`} onError={() => setFailed(src)} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} /> : String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase()}</span>;
}

export function Card({ title, icon, actions, children, className = '', body = true, sub }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <div className="card-h"><h2>{icon && <span className="ico-box soft"><Icon name={icon} size={17} /></span>}<span>{title}{sub && <div className="small muted" style={{ fontWeight: 400 }}>{sub}</div>}</span></h2><div className="row wrap">{actions}</div></div>}
      {body ? <div className="card-b">{children}</div> : children}
    </section>
  );
}
export function PageHead({ title, sub, actions }) { return <div className="page-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div className="row wrap">{actions}</div></div>; }
export function Stat({ icon, tone = 'blue', value, label, sub, delta, href, more, iconColor }) {
  const inner = (
    <div className={`stat ${tone}`}>
      <div className="top">{icon && <span className="ico" style={{ color: iconColor || 'var(--blue)' }}><Icon name={icon} size={20} /></span>}<div><div className="num">{value}</div><div className="lbl">{label}</div>{sub && <div className="sub">{sub}</div>}</div></div>
      {delta !== undefined && <div className={`delta ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}% <span className="muted" style={{ fontWeight: 400 }}>vs. last month</span></div>}
      {more && <div className="more">{more} →</div>}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none' }}>{inner}</Link> : inner;
}
export const Empty = ({ children = 'Nothing to show here yet.' }) => <div className="center muted" style={{ padding: 28 }}>{children}</div>;
export const Notice = ({ kind = 'note', children }) => <div className={kind}>{children}</div>;

// ---------- toast ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const timers = useRef(new Set());
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random(); setItems((a) => [...a, { id, text, kind }]);
    const timer = setTimeout(() => { timers.current.delete(timer); setItems((a) => a.filter((x) => x.id !== id)); }, 4500);
    timers.current.add(timer);
  }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toasts" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>{t.text}</div>)}</div></ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

// ---------- API ----------
export function useApi() {
  const router = useRouter(); const toast = useToast();
  return useCallback(async (method, url, body, opts = {}) => {
    try {
      const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
      const res = await fetch(`/api${url}`, { method, headers: isForm || body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json() : null;
      if (!res.ok) { if (!opts.silent) toast(data?.error || 'Something went wrong', 'error'); if (res.status === 401 && !opts.silent) router.push('/login'); return { ok: false, status: res.status, data, error: data?.error }; }
      if (opts.success) toast(opts.success);
      if (opts.refresh !== false && method !== 'GET') router.refresh();
      return { ok: true, status: res.status, data };
    } catch { toast('Network error - please try again', 'error'); return { ok: false, error: 'Network error' }; }
  }, [router, toast]);
}
export function useNav() {
  const router = useRouter(); const sp = useSearchParams(); const path = usePathname();
  const set = (patch, keepPage = false) => {
    const p = new URLSearchParams(sp?.toString() || '');
    for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null || v === 'All') p.delete(k); else p.set(k, String(v)); }
    if (!keepPage && !('page' in patch)) p.delete('page');
    const qs = p.toString(); router.push(qs ? `${path}?${qs}` : path);
  };
  return { get: (k, d = '') => sp?.get(k) ?? d, set, path };
}

// ---------- form helpers ----------
export function useForm(initial) {
  const [v, setV] = useState(initial);
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  const bind = (k) => ({ value: v[k] ?? '', onChange: (e) => set(k, e.target.type === 'checkbox' ? e.target.checked : e.target.value) });
  return [v, set, bind, setV];
}
export function Field({ label, required, hint, children, className = '' }) { return <label className={`f ${className}`}><span>{label}{required && <span className="req"> *</span>}</span>{children}{hint && <span className="hint">{hint}</span>}</label>; }
export const Input = (p) => <input {...p} className={`in ${p.className || ''}`} />;
export const Select = ({ options = [], placeholder, value, ...rest }) => (
  <select className="in" value={value ?? ''} {...rest}>{placeholder !== undefined && <option value="">{placeholder}</option>}{options.map((o) => { const [v, l] = Array.isArray(o) ? o : [typeof o === 'object' ? o.value : o, typeof o === 'object' ? o.label : o]; return <option key={v} value={v}>{l}</option>; })}</select>
);
export const Textarea = (p) => <textarea className="in" {...p} />;
export const Check = ({ checked, onChange, children, disabled }) => <label className="chk"><input type="checkbox" checked={!!checked} onChange={onChange} disabled={disabled} />{children}</label>;
export const Switch = ({ on, onChange, label }) => <button type="button" className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={!!on} aria-label={label} />;
export function Btn({ children, variant = '', icon, busy, disabled, onClick, className, ...rest }) {
  const pending = useRef(false); const mounted = useRef(false); const [working, setWorking] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const click = (event) => {
    if (pending.current || busy || disabled) { event.preventDefault(); return; }
    const result = onClick?.(event);
    if (result && typeof result.then === 'function') {
      pending.current = true; setWorking(true);
      Promise.resolve(result).finally(() => { pending.current = false; if (mounted.current) setWorking(false); }).catch(() => {});
    }
  };
  const loading = busy || working;
  return <button {...rest} className={className ?? `btn ${variant}`} disabled={loading || disabled} aria-busy={loading || undefined} onClick={click}>{icon && <Icon name={icon} size={15} />}{loading ? 'Please wait…' : children}</button>;
}

export function Modal({ title, onClose, children, footer, size = '' }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose?.(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="modal-b">{children}</div>{footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}
export function Confirm({ title, text, confirmLabel = 'Confirm', danger, onConfirm, onClose, needReason, reasonLabel = 'Reason' }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} size="sm" onClose={onClose} footer={<><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn variant={danger ? 'danger' : ''} busy={busy} disabled={needReason && !reason.trim()} onClick={async () => { setBusy(true); await onConfirm(reason); setBusy(false); }}>{confirmLabel}</Btn></>}>
      <p style={{ marginTop: 0 }}>{text}</p>{needReason && <Field label={reasonLabel} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
    </Modal>
  );
}
export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.key} role="tab" aria-selected={value === t.key} className={`tab ${value === t.key ? 'on' : ''}`} onClick={() => onChange(t.key)}>{t.icon && <Icon name={t.icon} size={15} />}{t.label}{t.count !== undefined && t.count !== null && <span className={t.plain ? 'pill c' : 'c'}>{t.count}</span>}</button>)}</div>;
}
export function Pills({ items, value, onChange }) {
  return <div className="row wrap">{items.map((t) => <button key={t.key} className={`pill ${value === t.key ? 'on' : ''}`} onClick={() => onChange(t.key)}>{t.icon && <Icon name={t.icon} size={14} />}{t.label}{t.count !== undefined && <span className="c">{t.count}</span>}</button>)}</div>;
}

export function DataTable({ columns, rows, rowKey = 'id', onRowClick, selectable, selected = [], onSelect, empty, rowClass, dense }) {
  const all = rows.length > 0 && rows.every((r) => selected.includes(r[rowKey]));
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
      <table className="tbl">
        <thead><tr>{selectable && <th style={{ width: 32 }}><input type="checkbox" checked={all} onChange={(e) => onSelect(e.target.checked ? rows.map((r) => r[rowKey]) : [])} aria-label="Select all" /></th>}{columns.map((c) => <th key={c.key} className={c.align === 'right' ? 'right' : ''} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length + (selectable ? 1 : 0)}><Empty>{empty}</Empty></td></tr>}
          {rows.map((r, i) => (
            <tr key={r[rowKey] ?? i} className={`${onRowClick ? 'clickable' : ''} ${rowClass ? rowClass(r) : ''}`} onClick={() => onRowClick?.(r)} style={dense ? { fontSize: 12 } : undefined}>
              {selectable && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.includes(r[rowKey])} onChange={(e) => onSelect(e.target.checked ? [...selected, r[rowKey]] : selected.filter((x) => x !== r[rowKey]))} aria-label="Select row" /></td>}
              {columns.map((c) => <td key={c.key} className={c.align === 'right' ? 'right' : ''}>{c.render ? c.render(r, i) : r[c.key] ?? '-'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Pager({ page, size, total, noun = 'entries' }) {
  const nav = useNav(); const pages = Math.max(1, Math.ceil(total / size)); const from = total ? (page - 1) * size + 1 : 0; const to = Math.min(total, page * size);
  const list = []; for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - page) <= 1) list.push(i); else if (list[list.length - 1] !== '…') list.push('…');
  return (
    <div className="pager"><span>Showing {from} to {to} of {total} {noun}</span>
      <div className="pg"><button disabled={page <= 1} onClick={() => nav.set({ page: page - 1 }, true)} aria-label="Previous page">‹</button>{list.map((p, i) => (p === '…' ? <span key={`e${i}`} style={{ padding: '0 6px' }}>…</span> : <button key={p} className={p === page ? 'on' : ''} onClick={() => nav.set({ page: p }, true)}>{p}</button>))}<button disabled={page >= pages} onClick={() => nav.set({ page: page + 1 }, true)} aria-label="Next page">›</button></div>
    </div>
  );
}
// Filter bar bound to URL search params
export function Filters({ fields, onApplyLabel = 'Apply' }) {
  const nav = useNav(); const [v, setV] = useState(() => Object.fromEntries(fields.map((f) => [f.key, nav.get(f.key, '')])));
  return (
    <div className="row wrap" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
      {fields.map((f) => (
        <Field key={f.key} label={f.label} className="grow">
          {f.type === 'select' ? <Select value={v[f.key] || ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} options={[['', f.all || 'All'], ...f.options]} /> : <Input type={f.type || 'text'} placeholder={f.placeholder} value={v[f.key] || ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && nav.set(v)} />}
        </Field>
      ))}
      <Btn onClick={() => nav.set(v)}>{onApplyLabel}</Btn><Btn variant="outline" onClick={() => { setV(Object.fromEntries(fields.map((f) => [f.key, '']))); nav.set(Object.fromEntries(fields.map((f) => [f.key, '']))); }}>Clear</Btn>
    </div>
  );
}
export function FileDrop({ onFiles, accept, multiple = true, label = 'Drag and drop files here or', hint = 'Supported files: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG (Max 10 MB each)' }) {
  const ref = useRef(null); const [over, setOver] = useState(false);
  return (
    <div className={`drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]); }}>
      <Icon name="upload" size={26} /><div>{label} <a href="#" onClick={(e) => { e.preventDefault(); ref.current?.click(); }}>click to upload</a></div><div className="small">{hint}</div>
      <input ref={ref} type="file" hidden multiple={multiple} accept={accept} onChange={(e) => { onFiles([...e.target.files]); e.target.value = ''; }} />
    </div>
  );
}
export function Steps({ steps }) { return <div className="steps">{steps.map((s, i) => <div key={s.label} className={`step ${s.state}`}><span className="c">{s.state === 'done' ? '✓' : s.state === 'failed' ? '✕' : i + 1}</span><b>{s.label}</b><span className="small">{s.sub}</span></div>)}</div>; }
export const Kv = ({ rows }) => <dl className="kv">{rows.filter(Boolean).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v ?? '-'}</dd></React.Fragment>)}</dl>;
export function Menu({ items, trigger }) {
  const [open, setOpen] = useState(false); const ref = useRef(null);
  useEffect(() => { if (!open) return; const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  return <span ref={ref} style={{ position: 'relative' }}><button className="icon-btn" onClick={() => setOpen(!open)} aria-label="More actions" aria-haspopup="menu">{trigger || <Icon name="more" />}</button>{open && <div className="menu" role="menu">{items.map((it) => (it.href ? <Link key={it.label} href={it.href} onClick={() => setOpen(false)}>{it.label}</Link> : <button key={it.label} onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>))}</div>}</span>;
}
export const useMemoArr = useMemo;
