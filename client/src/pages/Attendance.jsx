import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { roleLabel } from '../roles.js';

const WORKDAY_HOURS = 8;
const pad = (n) => String(n).padStart(2, '0');
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—');
const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 36e5;
const dur = (h) => `${Math.floor(h)}h ${pad(Math.round((h % 1) * 60) % 60)}m`;
const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shiftMonth = (m, by) => {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};
const hoursOf = (r, now) => (r.check_out ? hoursBetween(r.check_in, r.check_out) : hoursBetween(r.check_in, now));

export default function Attendance({ me }) {
  const supervises = me.level !== 'employee';
  const todayIso = new Date().toISOString().slice(0, 10);
  const thisMonth = todayIso.slice(0, 7);

  const [now, setNow] = useState(() => new Date());
  const [own, setOwn] = useState([]); // my rows for this and last month (today card, stats, week chart)
  const [month, setMonth] = useState(thisMonth);
  const [history, setHistory] = useState([]);
  const [board, setBoard] = useState([]);
  const [person, setPerson] = useState('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadOwn = () =>
    Promise.all([api(`/attendance?month=${thisMonth}`), api(`/attendance?month=${shiftMonth(thisMonth, -1)}`)]).then(([a, b]) => setOwn([...a, ...b]));
  const loadHistory = () => api(`/attendance?month=${month}${supervises ? '&scope=all' : ''}`).then(setHistory);
  const loadBoard = () => (supervises ? api('/attendance/board').then(setBoard) : Promise.resolve());

  useEffect(() => {
    loadOwn();
    loadBoard();
  }, []);
  useEffect(() => {
    loadHistory();
  }, [month]);

  const mine = own.find((r) => r.date === todayIso);
  const state = !mine ? 'idle' : mine.check_out ? 'done' : 'working';
  const workedToday = mine ? hoursOf(mine, now) : 0;

  const punch = async (action) => {
    setError('');
    setBusy(true);
    try {
      await api(`/attendance/${action}`, { method: 'POST' });
      await Promise.all([loadOwn(), loadHistory(), loadBoard()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // This month's numbers (completed days count their full hours, today counts live).
  const monthRows = own.filter((r) => r.date.startsWith(thisMonth));
  const monthHours = monthRows.reduce((s, r) => s + hoursOf(r, now), 0);

  // Last 7 days, oldest first, for the bar chart.
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${todayIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (6 - i));
    const iso = d.toISOString().slice(0, 10);
    const row = own.find((r) => r.date === iso);
    return { iso, label: d.toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' }), hours: row ? hoursOf(row, now) : 0, weekend: [0, 6].includes(d.getUTCDay()) };
  });

  const shown = history.filter((r) => person === 'all' || String(r.user_id) === person);
  const people = [...new Map(history.map((r) => [r.user_id, r.employee])).entries()];
  const ring = 2 * Math.PI * 54;
  const counts = {
    in: board.filter((b) => b.check_in && !b.check_out).length,
    done: board.filter((b) => b.check_out).length,
    leave: board.filter((b) => b.on_leave && !b.check_in).length,
  };
  counts.absent = board.length - counts.in - counts.done - counts.leave;

  return (
    <>
      <div className="att-top">
        <section className="card today-card">
          <div className="today-info">
            <div className="muted">{now.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
            <div className="big-clock" aria-live="off">{clock(now)}</div>
            <span className={`chip ${state === 'working' ? 'pending' : state === 'done' ? 'approved' : 'cancelled'}`}>
              {state === 'working' ? 'Working' : state === 'done' ? 'Completed' : 'Not checked in'}
            </span>
            <div className="times">
              <div><span className="muted">Check in</span><strong>{time(mine?.check_in)}</strong></div>
              <div><span className="muted">Check out</span><strong>{time(mine?.check_out)}</strong></div>
            </div>
            {error && <div className="error">{error}</div>}
            {state === 'idle' && <button className="btn primary big" disabled={busy} onClick={() => punch('check-in')}>Check in</button>}
            {state === 'working' && <button className="btn big out" disabled={busy} onClick={() => punch('check-out')}>Check out</button>}
            {state === 'done' && <button className="btn big" disabled>Completed for today</button>}
          </div>
          <div className="ring" role="img" aria-label={`Worked ${dur(workedToday)} today`}>
            <svg viewBox="0 0 128 128" width="150" height="150">
              <circle cx="64" cy="64" r="54" className="ring-bg" />
              <circle cx="64" cy="64" r="54" className="ring-fg" strokeDasharray={ring} strokeDashoffset={ring * (1 - Math.min(workedToday / WORKDAY_HOURS, 1))} />
            </svg>
            <div className="ring-text"><strong>{dur(workedToday)}</strong><span className="muted">of {WORKDAY_HOURS}h</span></div>
          </div>
        </section>

        <section className="card">
          <h3>Last 7 days</h3>
          <div className="week-chart">
            {week.map((d) => (
              <div key={d.iso} className={`bar-col ${d.weekend ? 'weekend' : ''}`} title={`${dayLabel(d.iso)}: ${d.hours ? dur(d.hours) : 'no record'}`}>
                <span className="bar-val">{d.hours ? d.hours.toFixed(1) : ''}</span>
                <div className="bar-track"><div className={`bar ${d.iso === todayIso ? 'today' : ''}`} style={{ height: `${Math.min(d.hours / 10, 1) * 100}%` }} /></div>
                <span className="bar-label">{d.label}</span>
              </div>
            ))}
          </div>
          <div className="mini-stats">
            <div><span className="muted">Days present</span><strong>{monthRows.length}</strong></div>
            <div><span className="muted">Hours this month</span><strong>{monthHours.toFixed(1)}</strong></div>
            <div><span className="muted">Avg per day</span><strong>{monthRows.length ? (monthHours / monthRows.length).toFixed(1) : '0.0'}h</strong></div>
          </div>
        </section>
      </div>

      {supervises && (
        <section className="card">
          <div className="toolbar">
            <h3>{me.level === 'boss' ? 'Organisation attendance today' : 'Team attendance today'}</h3>
            <div className="legend">
              <span><i className="dot in" /> In {counts.in}</span>
              <span><i className="dot done" /> Left {counts.done}</span>
              <span><i className="dot leave" /> On leave {counts.leave}</span>
              <span><i className="dot absent" /> Not in {counts.absent}</span>
            </div>
          </div>
          <div className="board">
            {board.map((b) => {
              const s = b.check_out ? 'done' : b.check_in ? 'in' : b.on_leave ? 'leave' : 'absent';
              return (
                <div key={b.id} className="board-item">
                  <div className="avatar sm">{b.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}</div>
                  <div className="board-name">
                    <strong>{b.name}</strong>
                    <span className="muted">{roleLabel(b.role)}</span>
                  </div>
                  <div className="board-status">
                    <span className={`dot ${s}`} />
                    {s === 'in' && <>In since {time(b.check_in)}</>}
                    {s === 'done' && <>{time(b.check_in)} – {time(b.check_out)}</>}
                    {s === 'leave' && <>On leave</>}
                    {s === 'absent' && <span className="muted">Not checked in</span>}
                  </div>
                </div>
              );
            })}
            {board.length === 0 && <p className="muted">No people to show.</p>}
          </div>
        </section>
      )}

      <section className="card">
        <div className="toolbar">
          <h3>{supervises ? (me.level === 'boss' ? 'Attendance History' : 'Team Attendance History') : 'My Attendance History'}</h3>
          <div className="actions">
            {supervises && (
              <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filter by person">
                <option value="all">Everyone</option>
                {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
            <div className="month-nav">
              <button className="btn small" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
              <span>{monthLabel(month)}</span>
              <button className="btn small" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
            </div>
          </div>
        </div>
        <table className="rt">
          <thead>
            <tr>{supervises && <th>Employee</th>}<th>Date</th><th>Check in</th><th>Check out</th><th>Hours</th><th>Status</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.user_id}-${r.date}`}>
                {supervises && <td data-label="Employee">{r.employee}</td>}
                <td data-label="Date">{dayLabel(r.date)}</td>
                <td data-label="Check in">{time(r.check_in)}</td>
                <td data-label="Check out">{time(r.check_out)}</td>
                <td data-label="Hours">{r.check_out ? dur(hoursBetween(r.check_in, r.check_out)) : '—'}</td>
                <td data-label="Status"><span className={`chip ${r.check_out ? 'approved' : 'pending'}`}>{r.check_out ? 'Complete' : 'Working'}</span></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={supervises ? 6 : 5} className="muted">No attendance recorded for {monthLabel(month)}.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
