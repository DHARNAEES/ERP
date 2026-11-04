import { Fragment, useEffect, useState } from 'react';
import { api } from '../api.js';
import { ROLE_LABELS, SUPERVISOR_ROLES, roleLabel } from '../roles.js';

const today = () => new Date().toISOString().slice(0, 10);
const PERSONAL_KEYS = ['birthday', 'join_date', 'gender', 'phone', 'address', 'emergency_name', 'emergency_phone'];
const EMPTY = {
  name: '', email: '', role: 'technical', manager_id: '', password: '',
  birthday: '', join_date: today(), gender: '', phone: '', address: '', emergency_name: '', emergency_phone: '',
};

const RoleOptions = () =>
  Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>);

// The personal-details inputs, shared by "Add Person" and the per-person details panel.
function PersonalFields({ values, onChange }) {
  const f = (k) => ({ value: values[k] ?? '', onChange: (e) => onChange(k, e.target.value) });
  return (
    <div className="fields">
      <label>Date of birth
        <input type="date" max={today()} {...f('birthday')} />
      </label>
      <label>Joined date
        <input type="date" required {...f('join_date')} />
      </label>
      <label>Gender
        <select {...f('gender')}>
          <option value="">Prefer not to say</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>Phone
        <input type="tel" placeholder="+91 98765 43210" {...f('phone')} />
      </label>
      <label className="wide">Address
        <textarea rows={2} maxLength={300} placeholder="House / street, city, state, PIN" {...f('address')} />
      </label>
      <label>Emergency contact name
        <input maxLength={100} {...f('emergency_name')} />
      </label>
      <label>Emergency contact phone
        <input type="tel" {...f('emergency_phone')} />
      </label>
    </div>
  );
}

export default function Employees({ me }) {
  const [employees, setEmployees] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null); // personal details being edited: { id, ...values }
  const isBoss = me.level === 'boss';

  const load = () => api('/employees').then(setEmployees);
  useEffect(() => {
    load();
  }, []);

  const run = async (fn) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    }
  };
  const patch = (id, body) => run(() => api(`/users/${id}`, { method: 'PATCH', body }));

  const q = query.trim().toLowerCase();
  const shown = employees.filter((e) => !q || `${e.name} ${e.email} ${roleLabel(e.role)}`.toLowerCase().includes(q));
  const supervisors = employees.filter((e) => e.active && SUPERVISOR_ROLES.includes(e.role));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/users', { method: 'POST', body: { ...form, manager_id: form.role === 'boss' ? null : Number(form.manager_id) } });
      setForm({ ...EMPTY, join_date: today() });
    });
  };

  const openDetails = (e) =>
    setEditing(editing?.id === e.id ? null : { id: e.id, ...Object.fromEntries(PERSONAL_KEYS.map((k) => [k, e[k] ?? ''])) });

  const saveDetails = (ev) => {
    ev.preventDefault();
    const { id, ...values } = editing;
    run(async () => {
      await api(`/users/${id}`, { method: 'PATCH', body: values });
      setEditing(null);
    });
  };

  return (
    <>
      {isBoss && (
        <section className="card">
          <h3>Add Employee</h3>
          <form onSubmit={create} className="form">
            <div className="form-section">Account</div>
            <div className="fields">
              <label>Full name
                <input required value={form.name} onChange={set('name')} />
              </label>
              <label>Work email
                <input required type="email" value={form.email} onChange={set('email')} />
              </label>
              <label>Role
                <select value={form.role} onChange={set('role')}><RoleOptions /></select>
              </label>
              {form.role !== 'boss' && (
                <label>Reports to
                  <select required value={form.manager_id} onChange={set('manager_id')}>
                    <option value="">Select…</option>
                    {supervisors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
              )}
              <label>Temporary password
                <input required minLength={8} type="text" placeholder="Min 8 characters" value={form.password} onChange={set('password')} />
              </label>
            </div>
            <div className="form-section">Personal details</div>
            <PersonalFields values={form} onChange={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />
            <p className="muted">The employee will be required to change this temporary password on first sign-in. Personal details are visible to the Boss role only.</p>
            {error && <div className="error">{error}</div>}
            <div><button className="btn primary" type="submit">Create account</button></div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="toolbar">
          <h3>{isBoss ? 'Employee Directory' : 'My Team'}</h3>
          <input type="search" placeholder="Search employees" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search employees" />
        </div>
        {!isBoss && error && <div className="error">{error}</div>}
        <table className="rt">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Reports to</th><th>Joined</th>{isBoss && <th>Account</th>}</tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <Fragment key={e.id}>
                <tr className={e.active ? '' : 'inactive'}>
                  <td data-label="Name">{e.name}{!e.active && <span className="chip rejected">disabled</span>}</td>
                  <td data-label="Email">{e.email}</td>
                  <td data-label="Role">
                    {isBoss && e.id !== me.id ? (
                      <select
                        value={e.role}
                        onChange={(ev) => patch(e.id, { role: ev.target.value, ...(ev.target.value === 'boss' ? {} : { manager_id: e.manager_id ?? me.id }) })}
                        aria-label={`Role for ${e.name}`}
                      >
                        <RoleOptions />
                      </select>
                    ) : roleLabel(e.role)}
                  </td>
                  <td data-label="Reports to">
                    {isBoss && e.role !== 'boss' ? (
                      <select value={e.manager_id ?? ''} onChange={(ev) => patch(e.id, { manager_id: Number(ev.target.value) })} aria-label={`Reports to for ${e.name}`}>
                        {supervisors.filter((m) => m.id !== e.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    ) : (e.manager ?? '—')}
                  </td>
                  <td data-label="Joined">{e.join_date}</td>
                  {isBoss && (
                    <td className="row-actions" data-label="Account">
                      <button className="btn small" aria-expanded={editing?.id === e.id} onClick={() => openDetails(e)}>Details</button>
                      {e.id !== me.id && (
                        <button className="btn small" onClick={() => patch(e.id, { active: !e.active })}>{e.active ? 'Disable' : 'Enable'}</button>
                      )}
                    </td>
                  )}
                </tr>
                {isBoss && editing?.id === e.id && (
                  <tr className="details-row">
                    <td colSpan={6}>
                      <form onSubmit={saveDetails} className="form">
                        <div className="form-section">Personal details — {e.name}</div>
                        <PersonalFields values={editing} onChange={(k, v) => setEditing((d) => ({ ...d, [k]: v }))} />
                        {error && <div className="error">{error}</div>}
                        <div className="actions">
                          <button className="btn primary small" type="submit">Save details</button>
                          <button className="btn small" type="button" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {shown.length === 0 && <tr><td colSpan={isBoss ? 6 : 5} className="muted">No employees match.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
