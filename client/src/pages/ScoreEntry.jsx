import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, saveScore } from '../api.js';
import ScorePicker from '../components/ScorePicker.jsx';

export default function ScoreEntry() {
  const { id } = useParams();
  const entryId = Number(id);
  const navigate = useNavigate();
  const [ballot, setBallot] = useState(null);
  const [error, setError] = useState(null);
  const [saveState, setSaveState] = useState(null); // 'saving' | 'saved' | 'queued' | error text
  const requestCountRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    api('/api/ballot').then(setBallot).catch((e) => setError(e.message));
  }, []);

  if (error) return <main className="page"><p className="error-text">{error}</p></main>;
  if (!ballot) return <main className="page"><p className="label">Loading…</p></main>;

  const idx = ballot.entries.findIndex((e) => e.id === entryId);
  const entry = ballot.entries[idx];
  if (!entry) return <main className="page"><p className="error-text">Entry not found on your ballot.</p></main>;

  const prev = ballot.entries[idx - 1];
  const next = ballot.entries[idx + 1];

  const setScore = async (criterionId, score) => {
    requestCountRef.current += 1;
    const currentRequest = requestCountRef.current;

    // Optimistic update; server response (or the queue) reconciles.
    setBallot((b) => ({
      ...b,
      entries: b.entries.map((e) =>
        e.id !== entryId
          ? e
          : {
              ...e,
              scores: { ...e.scores, [criterionId]: score },
              scoredCriteria: Object.keys({ ...e.scores, [criterionId]: score }).length,
              complete: b.criteria.every((c) => ({ ...e.scores, [criterionId]: score })[c.id] != null),
            }
      ),
    }));
    setSaveState('saving');
    try {
      const res = await saveScore(entryId, criterionId, score);
      if (currentRequest === requestCountRef.current && mountedRef.current) {
        if (res.ballot) setBallot(res.ballot);
        setSaveState(res.status);
      }
    } catch (err) {
      if (currentRequest === requestCountRef.current && mountedRef.current) {
        setSaveState(err.message);
        if (err.locked || err.status === 403) {
          const fresh = await api('/api/ballot').catch(() => null);
          if (fresh && currentRequest === requestCountRef.current && mountedRef.current) {
            setBallot(fresh);
          }
        }
      }
    }
  };

  return (
    <main className="page page--narrow">
      <p className="label">
        <Link to="/" style={{ color: 'inherit' }}>← Ballot</Link> · Entry {idx + 1} of {ballot.entries.length}
      </p>
      <h1 className="page-title">{entry.name}</h1>
      {entry.team && <p className="label">Team: {entry.team}</p>}
      {entry.description && <p className="lede">{entry.description}</p>}

      {ballot.locked && (
        <div className="notice notice--warn">Scoring is closed — scores are read-only.</div>
      )}

      <p className="label" style={{ marginTop: 'var(--s-4)', color: 'var(--c-ochre)' }}>
        1 = Limited · 3 = Solid · 5 = Standout
      </p>

      <div style={{ margin: 'var(--s-5) 0' }}>
        {ballot.criteria.map((c) => (
          <div className="criterion" key={c.id}>
            <div className="criterion__head">
              <span className="label" style={{ color: 'var(--c-ink)' }}>{c.name}</span>
            </div>
            <ScorePicker
              value={entry.scores[c.id] ?? null}
              disabled={ballot.locked}
              onChange={(n) => setScore(c.id, n)}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s-3)' }}>
        <button className="btn btn--ghost btn--small" disabled={!prev} onClick={() => navigate(`/entry/${prev.id}`)}>
          ← Prev
        </button>
        {saveState && (
          <span
            className={`save-status ${saveState === 'saved' ? 'save-status--saved' : 'save-status--queued'}`}
            role="status"
          >
            {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : saveState === 'queued' ? 'Offline — will sync' : saveState}
          </span>
        )}
        {next ? (
          <button className="btn btn--small" onClick={() => navigate(`/entry/${next.id}`)}>Next →</button>
        ) : (
          <button className="btn btn--small" onClick={() => navigate('/')}>Done</button>
        )}
      </div>
    </main>
  );
}
