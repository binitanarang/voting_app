import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Chevron from '../components/Chevron.jsx';

const POLL_MS = 10_000;

const RefreshIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);

const fmt = (v, d = 2) => (v == null ? '—' : v.toFixed(d));
const fmtZ = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`);

/* Expandable judge row: click to reveal that judge's full scorecard —
   per-criterion scores, weighted score, and z per entry. All data is already
   in the polled /api/results payload. */
function JudgeRow({ judge, index, entries, criteria, open, onToggle }) {
  return (
    <>
      <tr className="clickable" onClick={onToggle} aria-expanded={open}>
        <td className="rank">{index + 1}</td>
        <td className="col-name">
          <span className="judge-toggle"><Chevron open={open} /> {judge.name}</span>
        </td>
        <td className="num col-metric">{judge.scoredCount}/{judge.totalEntries}</td>
        <td className="num col-metric">{fmt(judge.mean)}</td>
        <td className="num col-metric">{fmt(judge.sd)}</td>
      </tr>
      {open && (
        <tr className="judge-detail">
          <td colSpan={5}>
            <div className="table-wrap">
              <table className="table table--sub">
                <thead>
                  <tr>
                    <th className="col-name">Entry name</th>
                    <th className="col-name">Team</th>
                    {criteria.map((c) => <th key={c.id} className="num">{c.name}</th>)}
                    <th className="num">Weighted</th>
                    <th className="num">Normalized</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const pj = e.perJudge.find((p) => p.judgeId === judge.id);
                    return (
                      <tr key={e.id}>
                        <td className="col-name">{e.name}</td>
                        <td className="col-name muted">{e.team || '—'}</td>
                        {criteria.map((c) => (
                          <td key={c.id} className="num">{pj?.criteria[c.id] ?? '—'}</td>
                        ))}
                        <td className="num">{fmt(pj?.weighted)}</td>
                        <td
                          className="num"
                          style={{ color: pj?.z == null ? undefined : pj.z >= 0 ? 'var(--c-green)' : 'var(--c-terracotta)' }}
                        >
                          {fmtZ(pj?.z)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Judges() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [catId, setCatId] = useState(null);
  const [openJudges, setOpenJudges] = useState(() => new Set());

  const toggleJudge = (id) =>
    setOpenJudges((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const load = () =>
    api('/api/results')
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, []);

  const category = useMemo(() => {
    if (!data) return null;
    return data.categories.find((c) => c.id === catId) ?? data.categories[0];
  }, [data, catId]);

  if (error && !data) return <main className="page"><p className="error-text">{error}</p></main>;
  if (!data || !category) return <main className="page"><p className="label">Loading…</p></main>;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="label">Scoring progress</p>
          <h1 className="page-title" style={{ marginBottom: 0 }}><em>Judges</em></h1>
        </div>
        <div className="page-actions">
          <div className="page-actions__buttons">
            <button className="btn btn--ghost btn--small" onClick={load} title="Refresh now">
              <RefreshIcon /> Refresh
            </button>
          </div>
          <span className="page-actions__meta num">
            Updated {new Date(data.generatedAt).toLocaleTimeString()} · refreshes every 10s
          </span>
        </div>
      </div>

      <div className="tabs">
        {data.categories.map((c) => (
          <button key={c.id} className={c.id === category.id ? 'active' : ''} onClick={() => setCatId(c.id)}>
            {c.name}{c.locked ? ' · scoring closed' : ''}
          </button>
        ))}
      </div>

      {error && <div className="notice notice--warn">Refresh failed: {error} — showing last data.</div>}

      <hr className="mara-rule mara-rule--ticked" style={{ margin: 'var(--s-4) 0' }} />

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th className="col-name">Judge name</th>
              <th className="num col-metric">Scored</th>
              <th className="num col-metric">Mean</th>
              <th className="num col-metric">Std dev</th>
            </tr>
          </thead>
          <tbody>
            {category.judges.map((j, i) => (
              <JudgeRow
                key={j.id}
                judge={j}
                index={i}
                entries={category.entries}
                criteria={data.criteria}
                open={openJudges.has(j.id)}
                onToggle={() => toggleJudge(j.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 'var(--s-4)', fontSize: 13 }}>
        Click a judge to see their full scorecard: raw scores per criterion, weighted score, and
        the normalization adjustment applied per entry. Mean and std dev are computed over the
        entries that judge has fully scored.
      </p>
    </main>
  );
}
