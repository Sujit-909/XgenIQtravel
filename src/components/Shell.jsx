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

function HeaderSearch() {
  const [q, setQ] = useState(''); const router = useRouter();
  return <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/trips?q=${encodeURIComponent(q.trim())}`); }}>
    <Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trips, bookings, destinations…" aria-label="Search trips" />
  </form>;
}

export default function Shell({ user, nav, counts, children, photoUrl }) {
  const path = usePathname(); const sp = useSearchParams(); const router = useRouter(); const api = useApi();
  const [menu, setMenu] = useState(false); const ref = useRef(null);
  useEffect(() => { if (!menu) return; const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setMenu(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [menu]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false); const [drawer, setDrawer] = useState(false);
  const sidebarRef = useRef(null); const toggleRef = useRef(null); const bodyRef = useRef(null); const contentRef = useRef(null); const previousPath = useRef(path);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => { setMobile(mq.matches); setDrawer(false); };
    sync(); mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  useEffect(() => { setDrawer(false); setMenu(false); }, [path, sp]);
  useEffect(() => {
    if (previousPath.current === path) return;
    previousPath.current = path;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.activeElement?.matches('input, textarea, select')) return;
    // Animate only committed content. No route keys, remounts, or navigation delays.
    const animation = contentRef.current?.animate?.([{ opacity: .97 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
    return () => animation?.cancel();
  }, [path]);
  useEffect(() => {
    if (!mobile || !drawer) return;
    const previous = document.activeElement; const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; bodyRef.current.inert = true;
    const background = bodyRef.current;
    const items = () => [...sidebarRef.current.querySelectorAll('a[href], button:not([disabled])')];
    items()[0]?.focus();
    const keydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setDrawer(false); }
      if (e.key === 'Tab') {
        const links = items(); const first = links[0]; const last = links.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; background.inert = false;
      document.removeEventListener('keydown', keydown);
      if (previous?.isConnected) previous.focus(); else toggleRef.current?.focus();
    };
  }, [mobile, drawer]);
  const badge = (b) => (b === 'pending' ? counts.pending : b === 'unread' ? counts.unread : 0);
  const logout = async () => { await api('POST', '/auth/logout', {}, { refresh: false }); router.push('/login'); };
  return (
    <div className={`shell ${collapsed ? 'sidebar-collapsed' : ''} ${drawer ? 'drawer-open' : ''}`}>
      {mobile && drawer && <button className="nav-backdrop" onClick={() => setDrawer(false)} aria-label="Close navigation" tabIndex={-1} />}
      <aside ref={sidebarRef} id="app-navigation" className="sidebar" aria-label="Main navigation" role={mobile && drawer ? 'dialog' : undefined} aria-modal={mobile && drawer ? true : undefined} inert={mobile && !drawer ? true : undefined}>
        <div className="brand"><Logo /><div className="brand-label">Travel<small>Management</small></div><button className="icon-btn drawer-close" onClick={() => setDrawer(false)} aria-label="Close navigation"><Icon name="x" /></button></div>
        <nav className="nav">
          {nav.map((n) => {
            const active = isActive(n.href, path, sp); const b = n.badge ? badge(n.badge) : 0;
            return (
              <React.Fragment key={n.label}>
                <Link href={n.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} data-tooltip={n.label} data-tooltip-collapsed="" onClick={() => setDrawer(false)}><Icon name={n.icon} size={17} /><span className="nav-label">{n.label}</span>{b > 0 && <span className="badge-n">{b}</span>}</Link>
                {n.group && path.startsWith('/services') && n.group.map(([l, h]) => <Link key={h} href={h} onClick={() => setDrawer(false)} className={`sub ${path === h ? 'active' : ''}`}>{l}</Link>)}
              </React.Fragment>
            );
          })}
        </nav>
      </aside>
      <div className="shell-body" ref={bodyRef}>
        <header className="topbar">
          <button ref={toggleRef} className="icon-btn sidebar-toggle" type="button" aria-controls="app-navigation" aria-expanded={mobile ? drawer : !collapsed} aria-label={mobile ? (drawer ? 'Close navigation' : 'Open navigation') : (collapsed ? 'Expand sidebar' : 'Collapse sidebar')} onClick={() => mobile ? setDrawer(!drawer) : setCollapsed(!collapsed)}><Icon name="menu" size={21} /></button>
          <HeaderSearch />
          <div className="grow" />
          <Link href="/notifications" className="bell" aria-label={`Notifications (${counts.unread} unread)`}><Icon name="bell" size={21} />{counts.unread > 0 && <span className="dot">{counts.unread}</span>}</Link>
          <div ref={ref} style={{ position: 'relative' }}>
            <button className="row" style={{ background: 'none', border: 0, gap: 10 }} onClick={() => setMenu(!menu)} data-tooltip="Account options" aria-label="Account options" onKeyDown={(e) => { if (e.key === 'Escape') setMenu(false); }} aria-haspopup="menu" aria-expanded={menu}>
              <Avatar name={user.name} src={photoUrl} /><div className="user-label" style={{ textAlign: 'left' }}><div className="bold" style={{ color: 'var(--navy)' }}>{user.name}</div><div className="small muted">{user.roleLabel}</div></div><Icon name="chevDown" size={15} />
            </button>
            {menu && <div className="menu" role="menu"><Link href="/profile" onClick={() => setMenu(false)}><Icon name="user" size={15} />My Profile</Link><Link href="/notifications" onClick={() => setMenu(false)}><Icon name="bell" size={15} />Notifications</Link><button onClick={logout}><Icon name="logout" size={15} />Sign out</button></div>}
          </div>
        </header>
        <main ref={contentRef} className="content">{children}</main>
      </div>
    </div>
  );
}
