import { useState } from 'react';
import { api } from '../api.js';
import PasswordInput from '../components/PasswordInput.jsx';

export default function Account({ me, onChanged }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setDone(false);
    if (form.next !== form.confirm) return setError('New passwords do not match');
    try {
      await api('/auth/change-password', { method: 'POST', body: { current: form.current, next: form.next } });
      setForm({ current: '', next: '', confirm: '' });
      setDone(true);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="card narrow">
      <h3>Change password</h3>
      {me.must_change_password && <p className="muted">Your password was set by an administrator. Choose a new one to continue.</p>}
      <form onSubmit={submit} className="form">
        <label>Current password
          <PasswordInput required autoComplete="current-password" value={form.current} onChange={set('current')} />
        </label>
        <label>New password (min 8 characters)
          <PasswordInput required minLength={8} autoComplete="new-password" value={form.next} onChange={set('next')} />
        </label>
        <label>Confirm new password
          <PasswordInput required minLength={8} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
        </label>
        {error && <div className="error">{error}</div>}
        {done && <div className="muted">Password updated.</div>}
        <button className="btn primary" type="submit">Update password</button>
      </form>
    </section>
  );
}
