'use client';

export default function DashboardError({ reset }) {
  return <section className="card"><div className="card-b stack"><p role="alert">Your dashboard summaries could not be loaded. Please try again.</p><div><button className="btn outline" onClick={reset}>Try again</button></div></div></section>;
}
