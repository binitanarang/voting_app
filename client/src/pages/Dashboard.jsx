import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import SpreadBar from '../components/SpreadBar.jsx';

const POLL_MS = 10_000;

const fmt = (v, d = 2) => (v == null ? '—' : v.toFixed(d));
const fmtZ = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(3)}`);

const COLUMNS = [
  { key: 'rank', label: '#', sort: (e) => e.rank ?? Infinity, asc: true },
  { key: 'name', label: 'Entry', sort: (e) => e.name.toLowerCase(), asc: true },
  { key: 'avgWeighted', label: 'Avg weighted', sort: (e) => e.avgWeighted ?? -Infinity, num: true },
  { key: 'normalized', label: 'Normalized', sort: (e) => e.normalized ?? -Infinity, num: true },
  { key: 'judges', label: 'Judges', sort: (e) => e.judgesScored, num: true },
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
      <p className="label">Live results</p>
      <h1 className="page-title"><em>Leaderboard</em></h1>

      <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="tabs" style={{ margin: 0 }}>
          {data.categories.map((c) => (
            <button key={c.id} className={c.id === category.id ? 'active' : ''} onClick={() => setCatId(c.id)}>
              {c.name}{c.locked ? ' · locked' : ''}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}>
          <a className="btn btn--ghost btn--small" href="/api/results.csv">Export CSV</a>
          <button className="btn btn--ghost btn--small" onClick={load}>Refresh</button>
        </span>
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
                  className={`sortable ${c.num ? 'num' : ''}`}
                  onClick={() => toggleSort(c.key)}
                >
                  {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
              <th>Spread</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => navigate(`/dashboard/entry/${e.id}`)}>
                <td className="rank">{e.rank ?? '—'}</td>
                <td>{e.name}</td>
                <td className="num">{fmt(e.avgWeighted)}</td>
                <td className="num">{fmtZ(e.normalized)}</td>
                <td className="num">{e.judgesScored}/{e.judgesTotal}</td>
                <td><SpreadBar spread={e.spread} avg={e.avgWeighted} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 'var(--s-4)', fontSize: 13 }}>
        Normalized = mean of per-judge z-scores (corrects harsh/lenient judges and narrow/wide
        scale use). Ties break on average weighted score. Updated{' '}
        <span className="num">{new Date(data.generatedAt).toLocaleTimeString()}</span> · refreshes every 10 s.
      </p>

      <section style={{ marginTop: 'var(--s-7)' }}>
        <p className="label">Judge progress · {category.name}</p>
        <div className="table-wrap" style={{ marginTop: 'var(--s-3)' }}>
          <table className="table">
            <thead>
              <tr><th>Judge</th><th className="num">Scored</th><th className="num">Mean</th><th className="num">Std dev</th></tr>
            </thead>
            <tbody>
              {category.judges.map((j) => (
                <tr key={j.id}>
                  <td>{j.name}</td>
                  <td className="num">{j.scoredCount}/{j.totalEntries}</td>
                  <td className="num">{fmt(j.mean)}</td>
                  <td className="num">{fmt(j.sd, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
