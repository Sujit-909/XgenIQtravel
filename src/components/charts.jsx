'use client';
import React from 'react';

export const PALETTE = ['#9aa4b8', '#1d5fe0', '#f5a623', '#ef6c3c', '#16a34a', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b', '#dc2626', '#0f172a'];

export function Donut({ data, size = 170, label, sub }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1; const r = 62; const c = 2 * Math.PI * r; let acc = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" role="img" aria-label={`${label || 'Total'}: ${total}`}>
      <circle cx="80" cy="80" r={r} fill="none" stroke="#eef2fa" strokeWidth="22" />
      {data.filter((d) => d.value > 0).map((d, i) => { const len = (d.value / total) * c; const el = <circle key={d.label} cx="80" cy="80" r={r} fill="none" stroke={d.color || PALETTE[i % PALETTE.length]} strokeWidth="22" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 80 80)" />; acc += len; return el; })}
      <text x="80" y="78" textAnchor="middle" fontSize="26" fontWeight="800" fill="#0b1d5e">{total}</text><text x="80" y="96" textAnchor="middle" fontSize="10" fill="#6a7a9b">{sub || label || 'Total'}</text>
    </svg>
  );
}
export function Legend({ data, total }) {
  const t = total ?? (data.reduce((s, d) => s + d.value, 0) || 1);
  return <div className="legend">{data.map((d, i) => <div key={d.label} className="row between" style={{ gap: 14 }}><span><span className="sw" style={{ background: d.color || PALETTE[i % PALETTE.length] }} />{d.label}</span><span className="muted">{d.value} <span className="small">({Math.round((d.value / t) * 1000) / 10}%)</span></span></div>)}</div>;
}
export function StackedBars({ data, keys, colors, height = 130, money }) {
  const max = Math.max(1, ...data.map((d) => keys.reduce((s, k) => s + (d[k] || 0), 0)));
  return (
    <svg viewBox={`0 0 ${data.length * 90 + 20} ${height + 28}`} width="100%" role="img" aria-label="Stacked bar chart">
      {data.map((d, i) => { let y = height; const x = 20 + i * 90; return <g key={d.label}>{keys.map((k, j) => { const h = ((d[k] || 0) / max) * (height - 10); y -= h; return <rect key={k} x={x} y={y} width="44" height={h} fill={colors[j]} rx="2" />; })}<text x={x + 22} y={height + 16} textAnchor="middle" fontSize="10" fill="#6a7a9b">{d.label}</text></g>; })}
      <text x="0" y="10" fontSize="9" fill="#6a7a9b">{money ? `max ${Math.round(max).toLocaleString('en-IN')}` : ''}</text>
    </svg>
  );
}
export function Spark({ value, max, color = '#1d5fe0' }) { return <div className="bar" aria-label={`${value} of ${max}`}><i style={{ width: `${Math.min(100, (value / (max || 1)) * 100)}%`, background: color }} /></div>; }
