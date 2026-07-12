import { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { api, onQueueChange, queueSize } from './api.js';
import Login from './pages/Login.jsx';
import Ballot from './pages/Ballot.jsx';
import ScoreEntry from './pages/ScoreEntry.jsx';
import Dashboard from './pages/Dashboard.jsx';
import EntryDetail from './pages/EntryDetail.jsx';
import Admin from './pages/Admin.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function Header() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(queueSize());
  useEffect(() => onQueueChange(setPending), []);

  if (!user) return null;
  const logout = async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    navigate('/login');
  };
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <span className="brand">
          AI <em>Competition</em>
        </span>
        <nav className="site-nav">
          {user.panel && <NavLink to="/">Ballot</NavLink>}
          <NavLink to="/dashboard">Dashboard</NavLink>
          {user.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          {pending > 0 && (
            <span className="save-status save-status--queued" title="Scores waiting to sync">
              {pending} pending
            </span>
          )}
          <button className="btn btn--ghost btn--small" onClick={logout}>
            {user.name.split(' ')[0]} · Log out
          </button>
        </nav>
      </div>
    </header>
  );
}

function Protected({ children, admin = false }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page"><p className="label">Loading…</p></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, loading }}>
      <Header />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <Protected>
              {user?.panel ? <Ballot /> : <Navigate to="/dashboard" replace />}
            </Protected>
          }
        />
        <Route path="/entry/:id" element={<Protected><ScoreEntry /></Protected>} />
        <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
        <Route path="/dashboard/entry/:id" element={<Protected><EntryDetail /></Protected>} />
        <Route path="/admin" element={<Protected admin><Admin /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}
