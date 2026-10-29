'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// One delegated layer serves existing controls without wrappers or per-row listeners.
export default function TooltipLayer() {
  const id = useId(); const bubble = useRef(null); const [tip, setTip] = useState(null);
  useEffect(() => {
    let target = null; let timer; let describedBy = null;
    const hide = () => {
      clearTimeout(timer);
      if (target) {
        if (describedBy === null) target.removeAttribute('aria-describedby');
        else target.setAttribute('aria-describedby', describedBy);
      }
      target = null; setTip(null);
    };
    const candidate = (node) => {
      if (!(node instanceof Element)) return null;
      const el = node.closest('[data-tooltip], button[aria-label], a[aria-label]');
      if (!el || el.disabled || el.closest('[inert]')) return null;
      if (el.dataset.tooltipCollapsed !== undefined && (!el.closest('.sidebar-collapsed') || window.matchMedia('(max-width: 767px)').matches)) return null;
      // Visible text already explains ordinary controls; icon controls keep their labels.
      if (!el.dataset.tooltip && !el.matches('.icon-btn, .bell, .switch') && el.textContent.trim()) return null;
      return el;
    };
    const show = (el) => {
      if (el === target) return;
      hide(); if (!el) return;
      target = el; describedBy = el.getAttribute('aria-describedby');
      timer = setTimeout(() => {
        if (!el.isConnected) { hide(); return; }
        const rect = el.getBoundingClientRect();
        el.setAttribute('aria-describedby', [describedBy, id].filter(Boolean).join(' '));
        setTip({ text: el.dataset.tooltip || el.getAttribute('aria-label'), left: Math.max(8, Math.min(rect.left + rect.width / 2, window.innerWidth - 8)), top: rect.bottom + 8 });
      }, 160);
    };
    const over = (e) => { if (e.pointerType !== 'touch') show(candidate(e.target)); };
    const out = (e) => { if (target && !target.contains(e.relatedTarget)) hide(); };
    const focus = (e) => show(candidate(e.target));
    const blur = (e) => { if (target && !target.contains(e.relatedTarget)) hide(); };
    const escape = (e) => { if (e.key === 'Escape') hide(); };
    document.addEventListener('pointerover', over); document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus); document.addEventListener('focusout', blur);
    document.addEventListener('keydown', escape); document.addEventListener('pointerdown', hide);
    window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide);
    return () => {
      hide(); document.removeEventListener('pointerover', over); document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus); document.removeEventListener('focusout', blur);
      document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', hide);
      window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide);
    };
  }, [id]);
  useEffect(() => {
    if (!tip || !bubble.current) return;
    const el = bubble.current; const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(tip.left - rect.width / 2, window.innerWidth - rect.width - 8))}px`;
    if (rect.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, tip.top - rect.height - 56)}px`;
    el.style.visibility = 'visible';
  }, [tip]);
  return tip ? createPortal(<div ref={bubble} id={id} role="tooltip" className="ui-tooltip" style={{ left: tip.left, top: tip.top, visibility: 'hidden' }}>{tip.text}</div>, document.body) : null;
}
