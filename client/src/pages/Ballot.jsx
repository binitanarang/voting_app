import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export function EntryBadge({ entry, criteriaCount }) {
  if (entry.complete) return <span className="badge badge--done">Scored</span>;
  if (entry.scoredCriteria > 0)
    return <span className="badge badge--partial">{entry.scoredCriteria}/{criteriaCount}</span>;
  return <span className="badge badge--todo">To do</span>;
}

export default function Ballot() {
  const [ballot, setBallot] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/ballot').then(setBallot).catch((e) => setError(e.message));
  }, []);

  if (error) return <main className="page"><p className="error-text">{error}</p></main>;
  if (!ballot) return <main className="page"><p className="label">Loading ballot…</p></main>;

  const { scored, total } = ballot.progress;
  const incomplete = ballot.entries.filter((e) => !e.complete && e.scoredCriteria > 0);

  return (
    <main className="page">
      <p className="label">{ballot.panel.name} · {ballot.category.name}</p>
      <h1 className="page-title">Your <em>ballot</em></h1>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--s-4)' }}>
        <p className="num muted">{scored} of {total} entries scored</p>
        {ballot.locked && <span className="badge badge--locked">Voting locked</span>}
      </div>
      <div className="progress-track" style={{ margin: 'var(--s-3) 0 var(--s-5)' }}>
        <div className="progress-fill" style={{ width: `${total ? (scored / total) * 100 : 0}%` }} />
      </div>

      {incomplete.length > 0 && (
        <div className="notice notice--warn">
          {incomplete.length === 1 ? 'One entry has' : `${incomplete.length} entries have`} a partially
          completed ballot — unfinished entries don't count toward results.
        </div>
      )}

      <ul className="entry-list">
        {ballot.entries.map((e) => (
          <li key={e.id}>
            <Link to={`/entry/${e.id}`}>
              <div style={{ flex: 1 }}>
                <div className="entry-name">{e.name}</div>
                {e.description && <div className="entry-desc">{e.description}</div>}
              </div>
              <EntryBadge entry={e} criteriaCount={ballot.criteria.length} />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
