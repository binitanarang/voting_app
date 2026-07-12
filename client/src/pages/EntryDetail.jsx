import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';

const fmt = (v, d = 2) => (v == null ? '—' : v.toFixed(d));
const fmtZ = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(3)}`);

export default function EntryDetail() {
  const { id } = useParams();
  const entryId = Number(id);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/results').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <main className="page"><p className="error-text">{error}</p></main>;
  if (!data) return <main className="page"><p className="label">Loading…</p></main>;

  let category = null;
  let entry = null;
  for (const c of data.categories) {
    const found = c.entries.find((e) => e.id === entryId);
    if (found) { category = c; entry = found; break; }
  }
  if (!entry) return <main className="page"><p className="error-text">Entry not found.</p></main>;

  const judgeStats = Object.fromEntries(category.judges.map((j) => [j.id, j]));

  return (
    <main className="page">
      <p className="label">
        <Link to="/dashboard" style={{ color: 'inherit' }}>← Leaderboard</Link> · {category.name}
      </p>
      <h1 className="page-title">{entry.name}</h1>
      {entry.description && <p className="lede">{entry.description}</p>}

      <div style={{ display: 'flex', gap: 'var(--s-6)', flexWrap: 'wrap', margin: 'var(--s-5) 0' }}>
        {[
          ['Rank', entry.rank ?? '—'],
          ['Avg weighted', fmt(entry.avgWeighted)],
          ['Normalized', fmtZ(entry.normalized)],
          ['Judges', `${entry.judgesScored}/${entry.judgesTotal}`],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="label">{label}</p>
            <p className="num" style={{ fontSize: 24, marginTop: 'var(--s-1)' }}>{value}</p>
          </div>
        ))}
      </div>

      <hr className="mara-rule mara-rule--ticked" style={{ margin: 'var(--s-4) 0' }} />

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Judge</th>
              {data.criteria.map((c) => <th key={c.id} className="num">{c.name}</th>)}
              <th className="num">Weighted</th>
              <th className="num">Judge mean</th>
              <th className="num">Z adjustment</th>
            </tr>
          </thead>
          <tbody>
            {entry.perJudge.map((pj) => {
              const st = judgeStats[pj.judgeId];
              return (
                <tr key={pj.judgeId}>
                  <td>{pj.judgeName}</td>
                  {data.criteria.map((c) => (
                    <td key={c.id} className="num">{pj.criteria[c.id] ?? '—'}</td>
                  ))}
                  <td className="num">{fmt(pj.weighted)}</td>
                  <td className="num">{fmt(st?.mean)}</td>
                  <td className="num" style={{ color: pj.z == null ? undefined : pj.z >= 0 ? 'var(--c-green)' : 'var(--c-terracotta)' }}>
                    {fmtZ(pj.z)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 'var(--s-4)', fontSize: 13 }}>
        Z adjustment = (judge's weighted score − that judge's mean) ÷ that judge's standard
        deviation, computed across every entry the judge scored. A judge who scores everything
        identically contributes 0. The entry's normalized score is the average of these values.
      </p>
    </main>
  );
}
