import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';

export default function Login() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [employeeId, setEmployeeId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api('/api/login', { method: 'POST', body: { employeeId, pin } });
      setUser(user);
      navigate(user.panel ? '/' : '/dashboard', { replace: true });
    } catch (err) {
      setError(err.status === 0 ? 'You appear to be offline.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page--narrow">
      <p className="label">Sign-in</p>
      <h1 className="page-title">
        Voting <em>App</em>
      </h1>
      <p className="lede">Enter your employee ID and PIN.</p>

      <form onSubmit={submit} style={{ marginTop: 'var(--s-6)' }}>
        <div className="field">
          <label className="label" htmlFor="emp">Employee ID</label>
          <input
            id="emp"
            className="input"
            autoComplete="username"
            autoCapitalize="characters"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="pin">PIN</label>
          <input
            id="pin"
            className="input input--pin"
            type="password"
            maxLength={64}
            placeholder="Same as your employee ID"
            autoCapitalize="characters"
            autoComplete="current-password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            required
          />
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn" disabled={busy || !pin.trim() || !employeeId.trim()} style={{ marginTop: 'var(--s-4)', width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
