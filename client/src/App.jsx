import { useEffect, useState } from 'react';
import { api, setUserId } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import Leaves from './pages/Leaves.jsx';
import Holidays from './pages/Holidays.jsx';
import Employees from './pages/Employees.jsx';
import Attendance from './pages/Attendance.jsx';

const NAV = [
  { group: 'Main', items: [{ id: 'dashboard', label: 'Dashboard', page: Dashboard }] },
  {
    group: 'HR Management',
    items: [
      { id: 'employees', label: 'Employees', page: Employees },
      { id: 'leaves', label: 'Leaves', page: Leaves },
      { id: 'attendance', label: 'Attendance', page: Attendance },
      { id: 'holidays', label: 'Holidays', page: Holidays },
      { id: 'benefits', label: 'Benefits' },
    ],
  },
  { group: 'Finance', items: [{ id: 'payroll', label: 'Payroll' }, { id: 'expenses', label: 'Expenses' }] },
  { group: 'Sales', items: [{ id: 'orders', label: 'Sales Orders' }] },
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);

export default function App() {
  const [me, setMe] = useState(null);
  const [route, setRoute] = useState('dashboard');
  const [dark, setDark] = useState(() => localStorage.getItem('dark') === '1');
  const [reloadKey, setReloadKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false); // slide-in sidebar on small screens

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('dark', dark ? '1' : '0');
  }, [dark]);

  useEffect(() => {
    api('/me').then(setMe);
  }, [reloadKey]);

  if (!me) return <div className="loading">Loading…</div>;

  const current = ALL_ITEMS.find((i) => i.id === route);
  const Page = current?.page;

  return (
    <div className="shell">
      <div className={`scrim ${menuOpen ? 'show' : ''}`} onClick={() => setMenuOpen(false)} />
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">PeopleHub</div>
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((i) => (
              <button key={i.id} className={`nav-item ${route === i.id ? 'active' : ''}`} onClick={() => { setRoute(i.id); setMenuOpen(false); }}>
                {i.label}
              </button>
            ))}
          </div>
        ))}
        <div className="profile">
          <div className="avatar">{me.name.split(' ').map((n) => n[0]).join('')}</div>
          <div>
            <div className="profile-name">{me.name}</div>
            <div className="muted capitalize">{me.role}</div>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <button className="menu-btn" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <span /><span /><span />
            </button>
            <h1>{current?.label}</h1>
          </div>
          <div className="topbar-actions">
            <select
              value={me.id}
              onChange={(e) => {
                setUserId(Number(e.target.value));
                setReloadKey((k) => k + 1);
              }}
              aria-label="Act as user"
            >
              {me.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
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
          {Page ? <Page key={`${route}-${reloadKey}`} me={me} go={(id) => { setRoute(id); setMenuOpen(false); }} /> : <div className="card muted">Coming soon.</div>}
        </main>
      </div>
    </div>
  );
}
