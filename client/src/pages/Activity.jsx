import { useEffect, useState } from 'react';
import { api } from '../api.js';

export const LABELS = {
  login: 'Signed in',
  login_failed: 'Failed sign-in attempt',
  password_changed: 'Changed password',
  password_reset: 'Password reset',
  leave_requested: 'Requested leave',
  leave_approved: 'Approved leave',
  leave_rejected: 'Rejected leave',
  leave_cancelled: 'Cancelled leave',
  user_created: 'Created account',
  user_updated: 'Updated account',
};

// SQLite stores UTC as "YYYY-MM-DD HH:MM:SS".
export const when = (at) => new Date(`${at.replace(' ', 'T')}Z`).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });

export default function Activity() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');

  const load = () => api('/audit').then(setRows);
  useEffect(() => {
    load();
  }, []);

  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => !q || `${r.actor} ${LABELS[r.action] ?? r.action} ${r.detail ?? ''}`.toLowerCase().includes(q));

  return (
    <section className="card">
      <div className="toolbar">
        <h3>Activity Log</h3>
        <div className="actions">
          <input type="search" placeholder="Search activity" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search activity" />
          <button className="btn small" onClick={load}>Refresh</button>
        </div>
      </div>
      <table className="rt">
        <thead>
          <tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id}>
              <td data-label="When">{when(r.at)}</td>
              <td data-label="Who">{r.actor ?? '—'}</td>
              <td data-label="Action">{LABELS[r.action] ?? r.action}</td>
              <td className="muted" data-label="Details">{r.detail ?? ''}</td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={4} className="muted">No activity.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
