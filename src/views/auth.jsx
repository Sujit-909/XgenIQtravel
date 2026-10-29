'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon, Logo, Field, Input, Btn, useApi, Select, useToast } from '@/components/ui';

const DEMO = process.env.NEXT_PUBLIC_DEMO_HINTS !== 'false';

export function OtpBoxes({ value, onChange }) {
  const refs = useRef([]);
  const digits = String(value).padEnd(6, ' ').split('');
  const set = (i, ch) => { const a = digits.map((d) => (d === ' ' ? '' : d)); a[i] = ch; onChange(a.join('')); if (ch && refs.current[i + 1]) refs.current[i + 1].focus(); };
  return (
    <div className="otp" onPaste={(e) => { const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6); if (t) { e.preventDefault(); onChange(t); refs.current[Math.min(t.length, 5)]?.focus(); } }}>
      {digits.map((d, i) => <input key={i} ref={(el) => (refs.current[i] = el)} inputMode="numeric" maxLength={1} value={d.trim()} aria-label={`Digit ${i + 1}`} onChange={(e) => set(i, e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Backspace' && !d.trim() && refs.current[i - 1]) refs.current[i - 1].focus(); }} />)}
    </div>
  );
}

export function LoginView() {
  const api = useApi(); const router = useRouter(); const toast = useToast();
  const [tab, setTab] = useState('in'); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [f, setF] = useState({ identifier: '', password: '', remember: true, show: false });
  const [r, setR] = useState({ name: '', email: '', phone: '', password: '' });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const res = await api('POST', '/auth/login', { identifier: f.identifier, password: f.password }, { silent: true, refresh: false });
    setBusy(false);
    if (!res.ok) return setErr(res.error || 'Unable to sign in');
    sessionStorage.setItem('geniq_mfa', JSON.stringify({ token: res.data.token, remember: f.remember, phone: res.data.phoneHint, email: res.data.emailHint }));
    router.push('/mfa');
  };
  const create = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const res = await api('POST', '/auth/register', r, { silent: true, refresh: false }); setBusy(false);
    if (!res.ok) return setErr(res.error); toast('Account created. Please sign in.'); setTab('in'); setF({ ...f, identifier: r.email });
  };
  const sso = async () => { const res = await api('POST', '/auth/sso', {}, { silent: true, refresh: false }); setErr(res.error || ''); };
  return (
    <div className="login-wrap">
      <div className="login-hero">
        <div className="row"><Logo size={30} /><div><div style={{ fontWeight: 800, fontSize: 20 }}>Travel Management</div><div className="small" style={{ opacity: .8 }}>Corporate Travel Platform</div></div></div>
        <div><h1>Your Business Travel Made Simple</h1><ul style={{ padding: 0, marginTop: 24 }}>{['Plan and request your trips', 'Book flights, hotels and more', 'Manage expenses', 'Stay compliant with policy'].map((t) => <li key={t}><Icon name="checkCircle" size={18} />{t}</li>)}</ul></div>
        <div className="row small between" style={{ opacity: .85 }}><span>Safe</span><span>Smart</span><span>Compliant</span><span>Anywhere</span></div>
      </div>
      <div className="center-page">
        <div className="login-card card"><div className="card-b" style={{ padding: 26 }}>
          <div className="tabs" style={{ marginBottom: 18 }}><button className={`tab ${tab === 'in' ? 'on' : ''}`} onClick={() => { setTab('in'); setErr(''); }}>Sign In</button><button className={`tab ${tab === 'up' ? 'on' : ''}`} onClick={() => { setTab('up'); setErr(''); }}>Create Account</button></div>
          {err && <div className="err mb" role="alert">{err}</div>}
          {tab === 'in' ? (
            <form className="stack" onSubmit={submit}>
              <h3>Sign In to XGENIQ Travel Portal</h3>
              <Field label="Email ID / Corporate Mobile Number" required><Input autoComplete="username" value={f.identifier} onChange={(e) => setF({ ...f, identifier: e.target.value })} placeholder="employee@abccorp.com / +91 9876543210" required /></Field>
              <Field label="Password" required><div style={{ position: 'relative' }}><Input autoComplete="current-password" type={f.show ? 'text' : 'password'} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /><button type="button" className="icon-btn" style={{ position: 'absolute', right: 6, top: 4 }} onClick={() => setF({ ...f, show: !f.show })} aria-label={f.show ? 'Hide password' : 'Show password'}><Icon name="eye" size={16} /></button></div></Field>
              <div className="row between"><label className="chk"><input type="checkbox" checked={f.remember} onChange={(e) => setF({ ...f, remember: e.target.checked })} />Remember me</label><Link href="/forgot-password">Forgot password?</Link></div>
              <Btn type="submit" busy={busy}>Sign In</Btn>
              <div className="center muted small">OR</div>
              <Btn type="button" variant="outline" onClick={sso}><Icon name="building" size={15} />Sign in with SSO (Company Account)</Btn>
              <div className="center small">New user? <a href="#" onClick={(e) => { e.preventDefault(); setTab('up'); }}>Create an account</a></div>
              {DEMO && <div className="note small"><b>Demo accounts</b> (password <code>Sujit@909</code>): sujit@xgeniq.com (Employee), manager@xgeniq.com (Manager), travel@xgeniq.com (Travel Desk), karan.mehta@abccorp.com (Finance), admin@xgeniq.com (Admin).</div>}
            </form>
          ) : (
            <form className="stack" onSubmit={create}>
              <h3>Create your account</h3>
              <Field label="Full name" required><Input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} required /></Field>
              <Field label="Corporate email" required><Input type="email" value={r.email} onChange={(e) => setR({ ...r, email: e.target.value })} placeholder="name@abccorp.com" required /></Field>
              <Field label="Mobile number" required><Input value={r.phone} onChange={(e) => setR({ ...r, phone: e.target.value })} placeholder="+91 9876543210" required /></Field>
              <Field label="Password" required hint="8+ characters with upper, lower case and a digit"><Input type="password" autoComplete="new-password" value={r.password} onChange={(e) => setR({ ...r, password: e.target.value })} required /></Field>
              <Btn type="submit" busy={busy}>Create Account</Btn>
            </form>
          )}
        </div></div>
      </div>
    </div>
  );
}

export function MfaView() {
  const api = useApi(); const router = useRouter();
  const [info, setInfo] = useState(null); const [method, setMethod] = useState('totp'); const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { try { const s = JSON.parse(sessionStorage.getItem('geniq_mfa') || 'null'); if (!s) router.replace('/login'); else setInfo(s); } catch { router.replace('/login'); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const verify = async (e) => {
    e?.preventDefault(); if (code.length < 6) return setErr('Enter the 6-digit code'); setBusy(true); setErr('');
    const res = await api('POST', '/auth/mfa', { token: info.token, code, method, remember: info.remember }, { silent: true, refresh: false }); setBusy(false);
    if (!res.ok) return setErr(res.error); sessionStorage.removeItem('geniq_mfa'); router.push('/dashboard'); router.refresh();
  };
  const opts = [['totp', 'Authenticator App (Recommended)', 'Use Google Authenticator, Microsoft Authenticator or any TOTP app.'], ['sms', 'SMS OTP', `Receive a code on your registered mobile number ${info?.phone || ''}`], ['email', 'Email OTP', `Receive a code on your corporate email ${info?.email || ''}`]];
  return (
    <div className="center-page"><form className="card" style={{ width: 460 }} onSubmit={verify}><div className="card-b stack" style={{ padding: 26 }}>
      <Link href="/login" className="small">‹ Back to Login</Link>
      <div className="center"><span className="ico-box soft" style={{ width: 54, height: 54, borderRadius: 14 }}><Icon name="lock" size={26} /></span><h2 style={{ marginTop: 10 }}>Multi-Factor Authentication</h2><div className="muted">Add an extra layer of security to your account.</div></div>
      {opts.map(([k, t, d]) => <label key={k} className="card" style={{ padding: 12, cursor: 'pointer', borderColor: method === k ? 'var(--blue)' : undefined }}><div className="row"><input type="radio" name="m" checked={method === k} onChange={() => setMethod(k)} /><div><div className="bold" style={{ color: 'var(--navy)' }}>{t}</div><div className="small muted">{d}</div></div></div></label>)}
      <Field label="Enter 6-digit code" required><OtpBoxes value={code} onChange={setCode} /></Field>
      {err && <div className="err" role="alert">{err}</div>}
      <Btn type="submit" busy={busy}>Verify & Continue</Btn>
      {DEMO && <div className="note small">Demo environment: no SMS / email gateway is connected, so the verification code is <b>246810</b>.</div>}
    </div></form></div>
  );
}

export function ForgotView() {
  const api = useApi(); const router = useRouter(); const [id, setId] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const send = async (e) => { e.preventDefault(); setBusy(true); setErr(''); const r = await api('POST', '/auth/forgot', { identifier: id }, { silent: true, refresh: false }); setBusy(false); if (!r.ok) return setErr(r.error); router.push(`/verify-otp?id=${encodeURIComponent(id)}`); };
  return (
    <div className="center-page"><form className="card" style={{ width: 420 }} onSubmit={send}><div className="card-b stack" style={{ padding: 26 }}>
      <Link href="/login" className="small">‹ Back to Login</Link><h2 className="center">Reset Your Password</h2><div className="muted center">Enter your registered email ID or mobile number to receive a verification code.</div>
      <Field label="Email ID / Mobile Number" required><Input value={id} onChange={(e) => setId(e.target.value)} placeholder="employee@abccorp.com / +91 9876543210" required /></Field>
      {err && <div className="err" role="alert">{err}</div>}<Btn type="submit" busy={busy}>Send OTP</Btn>
    </div></form></div>
  );
}

export function VerifyOtpView({ identifier }) {
  const api = useApi(); const router = useRouter(); const toast = useToast();
  const [code, setCode] = useState(''); const [token, setToken] = useState(null); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [left, setLeft] = useState(30);
  useEffect(() => { if (left <= 0) return undefined; const t = setTimeout(() => setLeft(left - 1), 1000); return () => clearTimeout(t); }, [left]);
  const verify = async (e) => { e.preventDefault(); setBusy(true); setErr(''); const r = await api('POST', '/auth/verify-otp', { identifier, code }, { silent: true, refresh: false }); setBusy(false); if (!r.ok) return setErr(r.error); setToken(r.data.resetToken); };
  const reset = async (e) => { e.preventDefault(); if (pw !== pw2) return setErr('Passwords do not match'); setBusy(true); setErr(''); const r = await api('POST', '/auth/reset', { token, password: pw }, { silent: true, refresh: false }); setBusy(false); if (!r.ok) return setErr(r.error); toast('Password updated. Please sign in.'); router.push('/login'); };
  return (
    <div className="center-page"><form className="card" style={{ width: 420 }} onSubmit={token ? reset : verify}><div className="card-b stack" style={{ padding: 26 }}>
      <Link href="/forgot-password" className="small">‹ Back</Link>
      {!token ? (<>
        <div className="center"><span className="ico-box soft" style={{ width: 54, height: 54, borderRadius: 14 }}><Icon name="phone" size={26} /></span><h2 style={{ marginTop: 10 }}>Verify Your Identity</h2><div className="muted">We have sent a 6-digit verification code to <b>{identifier}</b></div></div>
        <OtpBoxes value={code} onChange={setCode} />
        <div className="center small muted">Didn't receive the code? {left > 0 ? `Resend in 00:${String(left).padStart(2, '0')}` : <a href="#" onClick={async (e) => { e.preventDefault(); await api('POST', '/auth/forgot', { identifier }, { refresh: false, success: 'A new code has been sent' }); setLeft(30); }}>Resend</a>}</div>
        {err && <div className="err" role="alert">{err}</div>}<Btn type="submit" busy={busy} disabled={code.length < 6}>Verify & Continue</Btn>
        {DEMO && <div className="note small">Demo environment: the code is <b>246810</b>.</div>}
      </>) : (<>
        <h2 className="center">Create a new password</h2>
        <Field label="New password" required hint="8+ characters with upper, lower case and a digit"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Confirm password" required><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        {err && <div className="err" role="alert">{err}</div>}<Btn type="submit" busy={busy}>Update Password</Btn>
      </>)}
    </div></form></div>
  );
}
export { Select };
