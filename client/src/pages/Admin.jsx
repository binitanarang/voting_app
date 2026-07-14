import { useEffect, useState } from 'react';
import { api, apiUrl } from '../api.js';

const TABS = ['Criteria', 'Categories', 'Judges', 'Entries', 'Locks'];

export default function Admin() {
  const [tab, setTab] = useState('Criteria');
  const [meta, setMeta] = useState(null);
  const [judges, setJudges] = useState(null);
  const [flash, setFlash] = useState(null); // {kind:'ok'|'err', text}

  const loadMeta = () => api('/api/meta').then(setMeta);
  const loadJudges = () => api('/api/admin/judges').then((d) => setJudges(d.judges));
  useEffect(() => {
    Promise.all([loadMeta(), loadJudges()]).catch((e) => setFlash({ kind: 'err', text: e.message }));
  }, []);

  const run = async (fn, okText = 'Saved') => {
    try {
      const res = await fn();
      await Promise.all([loadMeta(), loadJudges()]);
      setFlash({ kind: 'ok', text: typeof okText === 'function' ? okText(res) : okText });
    } catch (e) {
      setFlash({ kind: 'err', text: e.message });
    }
  };

  if (!meta || !judges) return <main className="page"><p className="label">Loading admin…</p></main>;

  return (
    <main className="page page--admin">
      <p className="label">Administration</p>
      <h1 className="page-title">Competition <em>setup</em></h1>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'active' : ''} onClick={() => { setTab(t); setFlash(null); }}>
            {t}
          </button>
        ))}
      </div>

      {flash && (
        <div className={`notice ${flash.kind === 'ok' ? 'notice--ok' : 'notice--warn'}`} role="status">
          {flash.text}
        </div>
      )}

      {tab === 'Criteria' && (
        <CriteriaTab key={meta.criteria.map((c) => c.id).join('.')} meta={meta} run={run} />
      )}
      {tab === 'Categories' && (
        <CategoriesTab
          key={`${meta.criteria.map((c) => c.id).join('.')}:${meta.categories.map((c) => c.id).join('.')}`}
          meta={meta}
          run={run}
        />
      )}
      {tab === 'Judges' && <JudgesTab meta={meta} judges={judges} run={run} />}
      {tab === 'Entries' && <EntriesTab meta={meta} run={run} />}
      {tab === 'Locks' && <LocksTab meta={meta} run={run} />}
    </main>
  );
}

/* ---------- Entries ---------- */

function EntriesTab({ meta, run }) {
  const [entries, setEntries] = useState(null);
  const [editing, setEditing] = useState(null); // entry object being edited (or {id:null} for new)

  const load = () =>
    api('/api/results').then((d) =>
      setEntries(
        d.categories.flatMap((c) =>
          c.entries
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((e) => ({ id: e.id, name: e.name, description: e.description, team: e.team, categoryId: c.id, categoryName: c.name }))
        )
      )
    );
  useEffect(() => { load(); }, []);
  const runAndReload = (fn, msg) => run(async () => { await fn(); await load(); }, msg);

  if (!entries) return <p className="label">Loading entries…</p>;

  return (
    <section>
      {editing && (
        <EntryForm
          entry={editing}
          categories={meta.categories}
          onCancel={() => setEditing(null)}
          onSave={(payload) =>
            runAndReload(async () => {
              if (editing.id) await api(`/api/admin/entries/${editing.id}`, { method: 'PUT', body: payload });
              else await api('/api/admin/entries', { method: 'POST', body: payload });
              setEditing(null);
            }, editing.id ? 'Entry updated' : 'Entry added')
          }
        />
      )}
      {!editing && (
        <button className="btn btn--small" onClick={() => setEditing({ id: null, name: '', description: '', team: '', categoryId: meta.categories[0]?.id })}>
          + Add entry
        </button>
      )}
      <div className="table-wrap" style={{ marginTop: 'var(--s-4)' }}>
        <table className="table">
          <thead><tr><th>Entry name</th><th>Team</th><th>Category</th><th>Description</th><th /></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td className="muted">{e.team}</td>
                <td className="muted">{e.categoryName}</td>
                <td className="muted" style={{ maxWidth: 320 }}>{e.description}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn btn--ghost btn--small" onClick={() => setEditing(e)}>Edit</button>{' '}
                  <button
                    className="btn btn--danger btn--small"
                    onClick={() => {
                      if (confirm(`Delete "${e.name}" and all its scores?`)) {
                        runAndReload(() => api(`/api/admin/entries/${e.id}`, { method: 'DELETE' }), 'Entry deleted');
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EntryForm({ entry, categories, onSave, onCancel }) {
  const [name, setName] = useState(entry.name);
  const [description, setDescription] = useState(entry.description);
  const [team, setTeam] = useState(entry.team ?? '');
  const [categoryId, setCategoryId] = useState(entry.categoryId);
  return (
    <div className="card" style={{ marginBottom: 'var(--s-4)' }}>
      <div className="form-row">
        <div className="field">
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Team</label>
          <input className="input" value={team} onChange={(e) => setTeam(e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Category</label>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="field" style={{ marginTop: 'var(--s-3)' }}>
        <label className="label">Description</label>
        <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 'var(--s-3)' }}>
        <button className="btn btn--small" disabled={!name.trim()} onClick={() => onSave({ name, description, team, categoryId })}>
          Save
        </button>
        <button className="btn btn--ghost btn--small" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* ---------- Judges ---------- */

function JudgesTab({ meta, judges, run }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // judge row being edited
  const [form, setForm] = useState({ employeeId: '', name: '', panelId: '', role: 'judge' });
  const panelName = (id) => meta.panels.find((p) => p.id === id)?.name ?? '—';

  return (
    <section>
      {adding ? (
        <div className="card" style={{ marginBottom: 'var(--s-4)' }}>
          <div className="form-row">
            {[['employeeId', 'Employee ID'], ['name', 'Name']].map(([k, label]) => (
              <div className="field" key={k}>
                <label className="label">{label}</label>
                <input className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </div>
            ))}
            <div className="field">
              <label className="label">Panel</label>
              <select className="input" value={form.panelId} onChange={(e) => setForm({ ...form, panelId: e.target.value })}>
                <option value="">None (admin)</option>
                {meta.panels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Role</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="judge">Judge</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}>
            <button
              className="btn btn--small"
              onClick={() =>
                run(async () => {
                  await api('/api/admin/judges', {
                    method: 'POST',
                    body: { ...form, panelId: form.panelId ? Number(form.panelId) : null },
                  });
                  setAdding(false);
                  setForm({ employeeId: '', name: '', panelId: '', role: 'judge' });
                }, 'Judge added')
              }
            >
              Save
            </button>
            <button className="btn btn--ghost btn--small" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn btn--small" onClick={() => setAdding(true)}>+ Add judge</button>
      )}

      {editing && (
        <div className="card" style={{ margin: 'var(--s-4) 0' }}>
          <p className="label" style={{ marginBottom: 'var(--s-3)' }}>Editing {editing.employee_id}</p>
          <div className="form-row">
            <div className="field">
              <label className="label">Name</label>
              <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Panel</label>
              <select
                className="input"
                value={editing.panel_id ?? ''}
                onChange={(e) => setEditing({ ...editing, panel_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">None (admin)</option>
                {meta.panels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Role</label>
              <select className="input" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
                <option value="judge">Judge</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}>
            <button
              className="btn btn--small"
              disabled={!editing.name.trim()}
              onClick={() =>
                run(async () => {
                  await api(`/api/admin/judges/${editing.id}`, {
                    method: 'PUT',
                    body: { name: editing.name, panelId: editing.panel_id, role: editing.role },
                  });
                  setEditing(null);
                }, 'Judge updated')
              }
            >
              Save
            </button>
            <button className="btn btn--ghost btn--small" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: 'var(--s-4)' }}>
        <table className="table">
          <thead>
            <tr><th>Employee ID</th><th>Name</th><th>Panel</th><th>Role</th><th className="num">Completion</th><th /></tr>
          </thead>
          <tbody>
            {judges.map((j) => (
              <tr key={j.id}>
                <td className="num">{j.employee_id}</td>
                <td>{j.name}</td>
                <td className="muted">{panelName(j.panel_id)}</td>
                <td className="muted">{j.role === 'admin' ? 'Admin' : 'Judge'}</td>
                <td className="num">
                  {j.total == null ? '—' : (
                    <span className={j.scored === j.total ? 'ok-text' : ''}>{j.scored}/{j.total}</span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn btn--ghost btn--small" onClick={() => setEditing({ ...j })}>Edit</button>{' '}
                  <button
                    className="btn btn--danger btn--small"
                    onClick={() => {
                      if (confirm(`Delete ${j.name} and all their scores?`)) {
                        run(() => api(`/api/admin/judges/${j.id}`, { method: 'DELETE' }), 'Judge deleted');
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- Criteria (shared by every category) ---------- */

function CriteriaTab({ meta, run }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // {id, name}
  const [newCriterion, setNewCriterion] = useState('');

  return (
    <section>
      <p className="lede" style={{ marginBottom: 'var(--s-5)' }}>
        Judging criteria are shared by every category. Their per-category weights live in the
        Categories tab.
      </p>

      {adding ? (
        <div className="card" style={{ marginBottom: 'var(--s-4)' }}>
          <div className="field">
            <label className="label">Criterion name</label>
            <input className="input" value={newCriterion} onChange={(e) => setNewCriterion(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}>
            <button
              className="btn btn--small"
              disabled={!newCriterion.trim()}
              onClick={() =>
                run(async () => {
                  await api('/api/admin/criteria', { method: 'POST', body: { name: newCriterion } });
                  setNewCriterion('');
                  setAdding(false);
                }, 'Criterion added at weight 0 — rebalance each category in the Categories tab. Complete ballots become incomplete until judges score it.')
              }
            >
              Save
            </button>
            <button className="btn btn--ghost btn--small" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn btn--small" onClick={() => setAdding(true)}>+ Add criterion</button>
      )}

      {editing && (
        <div className="card" style={{ margin: 'var(--s-4) 0' }}>
          <p className="label" style={{ marginBottom: 'var(--s-3)' }}>Editing criterion</p>
          <div className="field">
            <label className="label">Name</label>
            <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}>
            <button
              className="btn btn--small"
              disabled={!editing.name.trim()}
              onClick={() =>
                run(async () => {
                  await api(`/api/admin/criteria/${editing.id}`, { method: 'PUT', body: { name: editing.name } });
                  setEditing(null);
                }, 'Criterion updated')
              }
            >
              Save
            </button>
            <button className="btn btn--ghost btn--small" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: 'var(--s-4)' }}>
        <table className="table">
          <thead>
            <tr><th>#</th><th>Criterion</th><th /></tr>
          </thead>
          <tbody>
            {meta.criteria.map((cr, i) => (
              <tr key={cr.id}>
                <td className="rank">{i + 1}</td>
                <td>{cr.name}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn btn--ghost btn--small" onClick={() => setEditing({ id: cr.id, name: cr.name })}>Edit</button>{' '}
                  <button
                    className="btn btn--danger btn--small"
                    onClick={() => {
                      if (confirm(`Delete "${cr.name}" and all its scores? Remaining weights are rescaled to keep each category at 100%.`)) {
                        run(() => api(`/api/admin/criteria/${cr.id}`, { method: 'DELETE' }), 'Criterion deleted — weights rescaled');
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- Categories (names, panels, weights) ---------- */

function CategoriesTab({ meta, run }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // category id being edited
  const [newCategory, setNewCategory] = useState('');

  return (
    <section>
      <p className="lede" style={{ marginBottom: 'var(--s-5)' }}>
        Weights are percentages per category and must sum to 100 — changing them recomputes
        results immediately; raw judge scores are never altered.
      </p>

      {adding ? (
        <div className="card" style={{ marginBottom: 'var(--s-4)' }}>
          <div className="field">
            <label className="label">Category name</label>
            <input className="input" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}>
            <button
              className="btn btn--small"
              disabled={!newCategory.trim()}
              onClick={() =>
                run(async () => {
                  await api('/api/admin/categories', { method: 'POST', body: { name: newCategory } });
                  setNewCategory('');
                  setAdding(false);
                }, 'Category added with its own panel and equal weights')
              }
            >
              Save
            </button>
            <button className="btn btn--ghost btn--small" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn btn--small" onClick={() => setAdding(true)}>+ Add category</button>
      )}

      {editing && (
        <div style={{ margin: 'var(--s-4) 0' }}>
          <CategoryCard
            key={editing}
            category={meta.categories.find((c) => c.id === editing)}
            meta={meta}
            run={run}
            onClose={() => setEditing(null)}
          />
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: 'var(--s-4)' }}>
        <table className="table">
          <thead>
            <tr><th>#</th><th>Category</th><th>Panel</th><th>Weights</th><th /></tr>
          </thead>
          <tbody>
            {meta.categories.map((c, i) => {
              const panel = meta.panels.find((p) => p.category_id === c.id);
              const pcts = meta.criteria.map((cr) => {
                const w = meta.weights.find((x) => x.category_id === c.id && x.criterion_id === cr.id);
                return w ? Math.round(w.weight * 10000) / 100 : 0;
              });
              return (
                <tr key={c.id}>
                  <td className="rank">{i + 1}</td>
                  <td>{c.name}</td>
                  <td className="muted">{panel?.name ?? '—'}</td>
                  <td className="muted num">{pcts.join(' / ')}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="btn btn--ghost btn--small" onClick={() => setEditing(c.id)}>Edit</button>{' '}
                    <button
                      className="btn btn--danger btn--small"
                      onClick={() => {
                        if (confirm(`Delete "${c.name}", all its entries and their scores? Judges on its panel become unassigned.`)) {
                          run(() => api(`/api/admin/categories/${c.id}`, { method: 'DELETE' }), 'Category deleted');
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CategoryCard({ category, meta, run, onClose }) {
  const panel = meta.panels.find((p) => p.category_id === category.id);
  const [name, setName] = useState(category.name);
  const [panelName, setPanelName] = useState(panel?.name ?? '');
  const [weights, setWeights] = useState(() =>
    Object.fromEntries(
      meta.criteria.map((cr) => {
        const w = meta.weights.find((x) => x.category_id === category.id && x.criterion_id === cr.id);
        return [cr.id, w ? Math.round(w.weight * 10000) / 100 : 0];
      })
    )
  );
  const sum = meta.criteria.reduce((n, cr) => n + (Number(weights[cr.id]) || 0), 0);
  const validWeights = Math.abs(sum - 100) < 0.01;
  const valid = name.trim() && (!panel || panelName.trim()) && validWeights;

  return (
    <div className="card" style={{ marginBottom: 'var(--s-4)' }}>
      <div className="form-row">
        <div className="field">
          <label className="label">Category name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {panel && (
          <div className="field">
            <label className="label">Panel name</label>
            <input className="input" value={panelName} onChange={(e) => setPanelName(e.target.value)} />
          </div>
        )}
      </div>
      <div className="form-row" style={{ marginTop: 'var(--s-3)' }}>
        {meta.criteria.map((cr) => (
          <div className="field" key={cr.id}>
            <label className="label">{cr.name} %</label>
            <input
              className="input num"
              type="number"
              min="0"
              max="100"
              step="1"
              value={weights[cr.id]}
              onChange={(e) => setWeights({ ...weights, [cr.id]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)', marginTop: 'var(--s-4)' }}>
        <button
          className="btn btn--small"
          disabled={!valid}
          onClick={() =>
            run(async () => {
              await api(`/api/admin/categories/${category.id}`, { method: 'PUT', body: { name } });
              if (panel) await api(`/api/admin/panels/${panel.id}`, { method: 'PUT', body: { name: panelName } });
              await api(`/api/admin/weights/${category.id}`, {
                method: 'PUT',
                body: { weights: Object.fromEntries(meta.criteria.map((cr) => [cr.id, Number(weights[cr.id])])) },
              });
              onClose?.();
            }, `Saved ${name}`)
          }
        >
          Save
        </button>
        {onClose && <button className="btn btn--ghost btn--small" onClick={onClose}>Cancel</button>}
        <span className={`num ${validWeights ? 'ok-text' : 'error-text'}`}>Σ {sum}%</span>
      </div>
    </div>
  );
}

/* ---------- Locks ---------- */

function LocksTab({ meta, run }) {
  const setLock = (categoryId, locked) =>
    run(
      async () => {
        const res = await api('/api/admin/lock', { method: 'PUT', body: { categoryId, locked } });
        if (locked) {
          // Server-side archive is already written; also hand the admin a local copy.
          const a = document.createElement('a');
          a.href = apiUrl('/api/results.csv');
          a.download = '';
          a.click();
        }
        return res;
      },
      (res) => {
        if (!locked) return 'Scoring reopened';
        if (res.exportError) return `Scoring closed, but auto-export failed: ${res.exportError}`;
        return `Scoring closed — results archived on the server (${res.exported.files.join(', ')}) and CSV downloaded.`;
      }
    );

  return (
    <section>
      <div className="switch-row">
        <div>
          <p style={{ fontSize: 17 }}>All scoring</p>
          <p className="muted" style={{ fontSize: 13 }}>Overrides per-category scoring while on.</p>
        </div>
        <button
          className={`btn btn--small ${meta.globalLocked ? 'btn--danger' : 'btn--ghost'}`}
          onClick={() => setLock(null, !meta.globalLocked)}
        >
          {meta.globalLocked ? 'Closed — reopen' : 'Open — close scoring'}
        </button>
      </div>
      {meta.categories.map((c) => (
        <div className="switch-row" key={c.id}>
          <p style={{ fontSize: 17 }}>{c.name}</p>
          <button
            className={`btn btn--small ${c.voting_locked ? 'btn--danger' : 'btn--ghost'}`}
            onClick={() => setLock(c.id, !c.voting_locked)}
          >
            {c.voting_locked ? 'Closed — reopen' : 'Open — close scoring'}
          </button>
        </div>
      ))}
    </section>
  );
}
