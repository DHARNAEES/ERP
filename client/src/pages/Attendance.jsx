import { useEffect, useState } from 'react';
import { api } from '../api.js';

const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—');

function hours(row) {
  if (!row.check_out) return '—';
  const h = (new Date(row.check_out) - new Date(row.check_in)) / 36e5;
  return `${h.toFixed(1)} h`;
}

export default function Attendance({ me }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const isManager = me.level !== 'employee'; // manager (team) or boss (everyone)

  const load = () => api(`/attendance${isManager ? '?scope=all' : ''}`).then(setRows);
  useEffect(() => {
    load();
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const mine = rows.find((r) => r.user_id === me.id && r.date === today);

  const punch = async (action) => {
    setError('');
    try {
      await api(`/attendance/${action}`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="grid two">
      <section className="card">
        <h3>Today</h3>
        <p className="muted">{new Date().toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <div className="row-pill"><span>Check in</span><strong>{time(mine?.check_in)}</strong></div>
        <div className="row-pill"><span>Check out</span><strong>{time(mine?.check_out)}</strong></div>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button className="btn primary" disabled={!!mine} onClick={() => punch('check-in')}>Check in</button>
          <button className="btn" disabled={!mine || !!mine.check_out} onClick={() => punch('check-out')}>Check out</button>
        </div>
      </section>

      <section className="card">
        <h3>{isManager ? (me.level === 'boss' ? 'All Attendance' : 'Team Attendance') : 'My Attendance'}</h3>
        <table>
          <thead>
            <tr>
              {isManager && <th>Employee</th>}
              <th>Date</th><th>In</th><th>Out</th><th>Hours</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.user_id}-${r.date}`}>
                {isManager && <td>{r.employee}</td>}
                <td>{r.date}</td>
                <td>{time(r.check_in)}</td>
                <td>{time(r.check_out)}</td>
                <td>{hours(r)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="muted">No attendance recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
