import { useEffect, useState } from 'react';
import { apiGlobal } from './api.js';

/* Landing page at / — lists the competitions this server hosts. Links are
   full page loads on purpose: the app re-boots with the competition's base
   path. Redirects automatically to the "default-seed" competition when it
   exists, or when there's exactly one competition; the picker only renders
   when neither applies. */
export default function CompetitionPicker() {
  const [competitions, setCompetitions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiGlobal('/api/competitions')
      .then((d) => {
        const def = d.competitions.find((c) => c.dir === 'default-seed');
        if (def) {
          window.location.replace(`/${def.dir}/`);
        } else if (d.competitions.length === 1) {
          window.location.replace(`/${d.competitions[0].dir}/`);
        } else {
          setCompetitions(d.competitions);
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <main className="page page--narrow"><p className="error-text">{error}</p></main>;
  if (!competitions) return <main className="page page--narrow"><p className="label">Loading…</p></main>;

  return (
    <main className="page page--narrow">
      <p className="label">Judging</p>
      <h1 className="page-title">Choose a <em>competition</em></h1>
      {competitions.length === 0 ? (
        <p className="lede">No competitions are set up yet. Run <span className="num">npm run seed</span> on the server.</p>
      ) : (
        <ul className="entry-list" style={{ marginTop: 'var(--s-5)' }}>
          {competitions.map((c) => (
            <li key={c.dir}>
              <a href={`/${c.dir}/`}>
                <div style={{ flex: 1 }}>
                  <div className="entry-name">{c.name}</div>
                  <div className="entry-desc num">/{c.dir}</div>
                </div>
                <span className="rank">→</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
