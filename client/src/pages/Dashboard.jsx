import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, apiUrl } from '../api.js';
import SpreadBar from '../components/SpreadBar.jsx';

const POLL_MS = 10_000;

const RefreshIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 21h16" />
  </svg>
);

const fmt = (v, d = 2) => (v == null ? '—' : v.toFixed(d));
const fmtZ = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`);

const COLUMNS = [
  { key: 'rank', label: '#', sort: (e) => e.rank ?? Infinity, asc: true, cls: '' },
  { key: 'name', label: 'Entry name', sort: (e) => e.name.toLowerCase(), asc: true, cls: 'col-name' },
  { key: 'avgWeighted', label: 'Avg weighted', sort: (e) => e.avgWeighted ?? -Infinity, num: true, cls: 'col-metric' },
  { key: 'normalized', label: 'Normalized', sort: (e) => e.normalized ?? -Infinity, num: true, cls: 'col-metric' },
  { key: 'judges', label: 'Judges', sort: (e) => e.judgesScored, num: true, cls: 'col-metric' },
];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [catId, setCatId] = useState(null);
  const [sort, setSort] = useState({ key: 'rank', dir: 1 });
  const navigate = useNavigate();

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

  const sorted = useMemo(() => {
    if (!category) return [];
    const col = COLUMNS.find((c) => c.key === sort.key) ?? COLUMNS[0];
    return [...category.entries].sort((a, b) => {
      const av = col.sort(a);
      const bv = col.sort(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return cmp * sort.dir * (col.asc ? 1 : -1);
    });
  }, [category, sort]);

  if (error && !data) return <main className="page"><p className="error-text">{error}</p></main>;
  if (!data || !category) return <main className="page"><p className="label">Loading results…</p></main>;

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="label">Live results</p>
          <h1 className="page-title" style={{ marginBottom: 0 }}><em>Leaderboard</em></h1>
        </div>
        <div className="page-actions">
          <div className="page-actions__buttons">
            <button className="btn btn--ghost btn--small" onClick={load} title="Refresh now">
              <RefreshIcon /> Refresh
            </button>
            <a className="btn btn--ghost btn--small" href={apiUrl('/api/results.csv')} title="Download results as CSV">
              <DownloadIcon /> Export CSV
            </a>
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
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={`sortable ${c.num ? 'num' : ''} ${c.cls}`}
                  onClick={() => toggleSort(c.key)}
                >
                  {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
              <th className="col-spread">Spread</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => navigate(`/dashboard/entry/${e.id}`)}>
                <td className="rank">{e.rank ?? '—'}</td>
                <td className="col-name">{e.name}</td>
                <td className="num col-metric">{fmt(e.avgWeighted)}</td>
                <td className="num col-metric">{fmtZ(e.normalized)}</td>
                <td className="num col-metric">{e.judgesScored}/{e.judgesTotal}</td>
                <td className="col-spread"><SpreadBar spread={e.spread} avg={e.avgWeighted} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 'var(--s-4)', fontSize: 13 }}>
        Normalized = mean of per-judge z-scores (corrects harsh/lenient judges and narrow/wide
        scale use). Ties break on average weighted score.
      </p>

      <section style={{ marginTop: 'var(--s-7)' }}>
        <p className="label">Judge progress · {category.name}</p>
        <div className="table-wrap" style={{ marginTop: 'var(--s-3)' }}>
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
                <tr key={j.id}>
                  <td className="rank">{i + 1}</td>
                  <td className="col-name">{j.name}</td>
                  <td className="num col-metric">{j.scoredCount}/{j.totalEntries}</td>
                  <td className="num col-metric">{fmt(j.mean)}</td>
                  <td className="num col-metric">{fmt(j.sd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
