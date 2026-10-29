'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon, Logo, Avatar, useApi } from './ui';

function isActive(href, path, search) {
  const [p, q] = href.split('?');
  if (p !== path) return false;
  if (!q) return !(search || '').toString() || !/(^|&)(tab|type)=/.test(search.toString());
  const want = new URLSearchParams(q); const have = new URLSearchParams(search?.toString() || '');
  return [...want.entries()].every(([k, v]) => have.get(k) === v);
}

export default function Shell({ user, nav, counts, children }) {
  const path = usePathname(); const sp = useSearchParams(); const router = useRouter(); const api = useApi();
  const [menu, setMenu] = useState(false); const [q, setQ] = useState(''); const ref = useRef(null);
  useEffect(() => { const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setMenu(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const badge = (b) => (b === 'pending' ? counts.pending : b === 'unread' ? counts.unread : 0);
  const logout = async () => { await api('POST', '/auth/logout', {}, { refresh: false }); router.push('/login'); };
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand"><Logo /><div>Travel<small>Management</small></div></div>
        <nav className="nav">
          {nav.map((n) => {
            const active = isActive(n.href, path, sp); const b = n.badge ? badge(n.badge) : 0;
            return (
              <React.Fragment key={n.label}>
                <Link href={n.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}><Icon name={n.icon} size={17} />{n.label}{b > 0 && <span className="badge-n">{b}</span>}</Link>
                {n.group && path.startsWith('/services') && n.group.map(([l, h]) => <Link key={h} href={h} className={`sub ${path === h ? 'active' : ''}`}>{l}</Link>)}
              </React.Fragment>
            );
          })}
        </nav>
      </aside>
      <div>
        <header className="topbar">
          <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/trips?q=${encodeURIComponent(q.trim())}`); }}>
            <Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trips, bookings, destinations…" aria-label="Search trips" />
          </form>
          <div className="grow" />
          <Link href="/notifications" className="bell" aria-label={`Notifications (${counts.unread} unread)`}><Icon name="bell" size={21} />{counts.unread > 0 && <span className="dot">{counts.unread}</span>}</Link>
          <div ref={ref} style={{ position: 'relative' }}>
            <button className="row" style={{ background: 'none', border: 0, gap: 10 }} onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
              <Avatar name={user.name} /><div style={{ textAlign: 'left' }}><div className="bold" style={{ color: 'var(--navy)' }}>{user.name}</div><div className="small muted">{user.roleLabel}</div></div><Icon name="chevDown" size={15} />
            </button>
            {menu && <div className="menu" role="menu"><Link href="/profile" onClick={() => setMenu(false)}><Icon name="user" size={15} />My Profile</Link><Link href="/notifications" onClick={() => setMenu(false)}><Icon name="bell" size={15} />Notifications</Link><button onClick={logout}><Icon name="logout" size={15} />Sign out</button></div>}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
