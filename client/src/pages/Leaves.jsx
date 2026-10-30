import { useEffect, useState } from 'react';
import { api } from '../api.js';

const TYPES = ['Sick Leave', 'Casual Leave', 'Leave with Pay', 'Comp Off'];
const EMPTY = { type: 'Casual Leave', start_date: '', end_date: '', reason: '' };

export default function Leaves({ me }) {
  const [leaves, setLeaves] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const isManager = me.role === 'manager';

  const load = () => api(`/leaves${isManager ? '?scope=all' : ''}`).then(setLeaves);
  useEffect(() => {
    load();
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api('/leaves', { method: 'POST', body: form });
      setForm(EMPTY);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const update = async (id, status) => {
    setError('');
    try {
      await api(`/leaves/${id}`, { method: 'PATCH', body: { status } });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="grid two">
      <section className="card">
        <h3>Apply for Leave</h3>
        <form onSubmit={submit} className="form">
          <label>Type
            <select value={form.type} onChange={set('type')}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>From
            <input type="date" required value={form.start_date} onChange={set('start_date')} />
          </label>
          <label>To
            <input type="date" required value={form.end_date} min={form.start_date} onChange={set('end_date')} />
          </label>
          <label>Reason
            <textarea rows={3} value={form.reason} onChange={set('reason')} />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="btn primary" type="submit">Submit request</button>
        </form>
      </section>

      <section className="card">
        <h3>{isManager ? 'All Leave Requests' : 'My Leave Requests'}</h3>
        <table>
          <thead>
            <tr>
              {isManager && <th>Employee</th>}
              <th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {leaves.map((l) => (
              <tr key={l.id}>
                {isManager && <td>{l.employee}</td>}
                <td>{l.type}</td>
                <td>{l.start_date === l.end_date ? l.start_date : `${l.start_date} → ${l.end_date}`}</td>
                <td>{l.days}</td>
                <td><span className={`chip ${l.status}`}>{l.status}</span></td>
                <td className="row-actions">
                  {l.status === 'pending' && isManager && (
                    <>
                      <button className="btn small" onClick={() => update(l.id, 'approved')}>Approve</button>
                      <button className="btn small" onClick={() => update(l.id, 'rejected')}>Reject</button>
                    </>
                  )}
                  {l.status === 'pending' && l.user_id === me.id && (
                    <button className="btn small" onClick={() => update(l.id, 'cancelled')}>Cancel</button>
                  )}
                </td>
              </tr>
            ))}
            {leaves.length === 0 && (
              <tr><td colSpan={6} className="muted">No requests yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
