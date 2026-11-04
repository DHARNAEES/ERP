import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import Leaves from './pages/Leaves.jsx';
import Holidays from './pages/Holidays.jsx';
import Employees from './pages/Employees.jsx';
import Attendance from './pages/Attendance.jsx';
import Activity from './pages/Activity.jsx';
import Account from './pages/Account.jsx';
import Login from './pages/Login.jsx';
import { roleLabel } from './roles.js';

// `roles` limits who sees (and may open) a page. The server enforces the same rules;
// hiding a menu item is only for convenience.
const NAV = [
  { group: 'Main', items: [{ id: 'dashboard', label: 'Dashboard', page: Dashboard }] },
  {
    group: 'HR Management',
    items: [
      { id: 'employees', label: 'Employees', page: Employees, roles: ['manager', 'boss'] },
      { id: 'leaves', label: 'Leaves', page: Leaves },
      { id: 'attendance', label: 'Attendance', page: Attendance },
      { id: 'holidays', label: 'Holidays', page: Holidays },
      { id: 'benefits', label: 'Benefits' },
    ],
  },
  { group: 'Finance', items: [{ id: 'payroll', label: 'Payroll' }, { id: 'expenses', label: 'Expenses' }] },
  { group: 'Sales', items: [{ id: 'orders', label: 'Sales Orders' }] },
  { group: 'Administration', roles: ['boss'], items: [{ id: 'activity', label: 'Activity Log', page: Activity }] },
];

const ACCOUNT = { id: 'account', label: 'Change Password', page: Account };

export default function App() {
  const [me, setMe] = useState(null);
  const [authed, setAuthed] = useState(() => !!getToken());
  const [route, setRoute] = useState('dashboard');
  const [dark, setDark] = useState(() => localStorage.getItem('dark') === '1');
  const [menuOpen, setMenuOpen] = useState(false); // slide-in sidebar on small screens

  const loadMe = useCallback(() => api('/me').then(setMe).catch(() => {}), []);

  useEffect(() => {
    const onLogout = () => {
      setAuthed(false);
      setMe(null);
    };
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  useEffect(() => {
    if (authed) loadMe();
  }, [authed, loadMe]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('dark', dark ? '1' : '0');
  }, [dark]);

  const logout = () => {
    setToken(null);
    setAuthed(false);
    setMe(null);
    setRoute('dashboard');
  };

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  if (!me) return <div className="loading">Loading…</div>;

  const groups = NAV.filter((g) => !g.roles || g.roles.includes(me.level)).map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || i.roles.includes(me.level)),
  }));
  const allItems = [...groups.flatMap((g) => g.items), ACCOUNT];
  // Until they replace an admin-set password, users can only reach the change-password page.
  const current = me.must_change_password ? ACCOUNT : allItems.find((i) => i.id === route) ?? allItems[0];
  const Page = current.page;
  const go = (id) => {
    setRoute(id);
    setMenuOpen(false);
  };

  return (
    <div className="shell">
      <div className={`scrim ${menuOpen ? 'show' : ''}`} onClick={() => setMenuOpen(false)} />
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">PeopleHub</div>
        {groups.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((i) => (
              <button key={i.id} className={`nav-item ${current.id === i.id ? 'active' : ''}`} disabled={me.must_change_password} onClick={() => go(i.id)}>
                {i.label}
              </button>
            ))}
          </div>
        ))}
        <div className="profile">
          <div className="avatar">{me.name.split(' ').map((n) => n[0]).join('')}</div>
          <div>
            <div className="profile-name">{me.name}</div>
            <div className="muted">{roleLabel(me.role)}</div>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <button className="menu-btn" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <span /><span /><span />
            </button>
            <h1>{current.label}</h1>
          </div>
          <div className="topbar-actions">
            {!me.must_change_password && current.id !== 'account' && (
              <button className="btn small" onClick={() => go('account')}>Change password</button>
            )}
            <button className="btn small" onClick={logout}>Sign out</button>
            <button
              className={`switch ${dark ? 'on' : ''}`}
              role="switch"
              aria-checked={dark}
              aria-label="Dark mode"
              onClick={() => setDark((d) => !d)}
            >
              <span className="switch-knob">{dark ? '☾' : '☀'}</span>
            </button>
          </div>
        </header>
        <main className="content">
          {Page ? <Page key={current.id} me={me} go={go} onChanged={loadMe} /> : <div className="card muted">Coming soon.</div>}
        </main>
      </div>
    </div>
  );
}
