import { useEffect, useState } from 'react';
import { api } from '../api.js';

const TABS = ['Entries', 'Judges', 'Weights', 'Locks'];

export default function Admin() {
  const [tab, setTab] = useState('Entries');
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
    <main className="page">
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

      {tab === 'Entries' && <EntriesTab meta={meta} run={run} />}
      {tab === 'Judges' && <JudgesTab meta={meta} judges={judges} run={run} />}
      {tab === 'Weights' && <WeightsTab meta={meta} run={run} />}
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
            .map((e) => ({ id: e.id, name: e.name, description: e.description, categoryId: c.id, categoryName: c.name }))
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
        <button className="btn btn--small" onClick={() => setEditing({ id: null, name: '', description: '', categoryId: meta.categories[0]?.id })}>
          + Add entry
        </button>
      )}
      <div className="table-wrap" style={{ marginTop: 'var(--s-4)' }}>
        <table className="table">
          <thead><tr><th>Entry</th><th>Category</th><th>Description</th><th /></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
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
  const [categoryId, setCategoryId] = useState(entry.categoryId);
  return (
    <div className="card" style={{ marginBottom: 'var(--s-4)' }}>
      <div className="form-row">
        <div className="field">
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
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
        <button className="btn btn--small" disabled={!name.trim()} onClick={() => onSave({ name, description, categoryId })}>
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
  const [form, setForm] = useState({ employeeId: '', name: '', pin: '', panelId: '', role: 'judge' });
  const panelName = (id) => meta.panels.find((p) => p.id === id)?.name ?? '—';

  const resetPin = (j) => {
    const pin = prompt(`New 4-digit PIN for ${j.name}:`);
    if (pin == null) return;
    if (!/^\d{4}$/.test(pin)) return alert('PIN must be exactly 4 digits.');
    run(() => api(`/api/admin/judges/${j.id}/pin`, { method: 'POST', body: { pin } }), `PIN reset for ${j.name} (sessions invalidated)`);
  };

  return (
    <section>
      {adding ? (
        <div className="card" style={{ marginBottom: 'var(--s-4)' }}>
          <div className="form-row">
            {[['employeeId', 'Employee ID'], ['name', 'Name'], ['pin', 'PIN (4 digits)']].map(([k, label]) => (
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
                <option value="judge">judge</option>
                <option value="admin">admin</option>
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
                  setForm({ employeeId: '', name: '', pin: '', panelId: '', role: 'judge' });
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
                <td className="muted">{j.role}</td>
                <td className="num">
                  {j.total == null ? '—' : (
                    <span className={j.scored === j.total ? 'ok-text' : ''}>{j.scored}/{j.total}</span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn btn--ghost btn--small" onClick={() => resetPin(j)}>Reset PIN</button>{' '}
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

/* ---------- Weights ---------- */

function WeightsTab({ meta, run }) {
  // percents keyed by category then criterion
  const initial = {};
  for (const c of meta.categories) {
    initial[c.id] = {};
    for (const cr of meta.criteria) {
      const w = meta.weights.find((x) => x.category_id === c.id && x.criterion_id === cr.id);
      initial[c.id][cr.id] = w ? Math.round(w.weight * 10000) / 100 : 0;
    }
  }
  const [values, setValues] = useState(initial);

  return (
    <section>
      <p className="lede" style={{ marginBottom: 'var(--s-5)' }}>
        Weights are percentages per category and must sum to 100. Changing weights immediately
        changes computed results — raw judge scores are never altered.
      </p>
      {meta.categories.map((c) => {
        const sum = meta.criteria.reduce((n, cr) => n + (Number(values[c.id][cr.id]) || 0), 0);
        const valid = Math.abs(sum - 100) < 0.01;
        return (
          <div className="card" key={c.id} style={{ marginBottom: 'var(--s-4)' }}>
            <p className="label" style={{ marginBottom: 'var(--s-3)' }}>{c.name}</p>
            <div className="form-row">
              {meta.criteria.map((cr) => (
                <div className="field" key={cr.id}>
                  <label className="label">{cr.name}</label>
                  <input
                    className="input num"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={values[c.id][cr.id]}
                    onChange={(e) =>
                      setValues({ ...values, [c.id]: { ...values[c.id], [cr.id]: e.target.value } })
                    }
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)', marginTop: 'var(--s-4)' }}>
              <button
                className="btn btn--small"
                disabled={!valid}
                onClick={() =>
                  run(() =>
                    api(`/api/admin/weights/${c.id}`, {
                      method: 'PUT',
                      body: { weights: Object.fromEntries(meta.criteria.map((cr) => [cr.id, Number(values[c.id][cr.id])])) },
                    }), `Weights saved for ${c.name}`)
                }
              >
                Save weights
              </button>
              <span className={`num ${valid ? 'ok-text' : 'error-text'}`}>Σ {sum}%</span>
            </div>
          </div>
        );
      })}
    </section>
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
          a.href = '/api/results.csv';
          a.download = '';
          a.click();
        }
        return res;
      },
      (res) => {
        if (!locked) return 'Voting unlocked';
        if (res.exportError) return `Voting locked, but auto-export failed: ${res.exportError}`;
        return `Voting locked — results archived on the server (${res.exported.files.join(', ')}) and CSV downloaded.`;
      }
    );

  return (
    <section>
      <div className="switch-row">
        <div>
          <p style={{ fontSize: 17 }}>All voting</p>
          <p className="muted" style={{ fontSize: 13 }}>Overrides per-category locks while on.</p>
        </div>
        <button
          className={`btn btn--small ${meta.globalLocked ? 'btn--danger' : 'btn--ghost'}`}
          onClick={() => setLock(null, !meta.globalLocked)}
        >
          {meta.globalLocked ? 'Locked — unlock' : 'Open — lock'}
        </button>
      </div>
      {meta.categories.map((c) => (
        <div className="switch-row" key={c.id}>
          <p style={{ fontSize: 17 }}>{c.name}</p>
          <button
            className={`btn btn--small ${c.voting_locked ? 'btn--danger' : 'btn--ghost'}`}
            onClick={() => setLock(c.id, !c.voting_locked)}
          >
            {c.voting_locked ? 'Locked — unlock' : 'Open — lock'}
          </button>
        </div>
      ))}
    </section>
  );
}
