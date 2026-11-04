import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const TYPES = ['Sick Leave', 'Casual Leave', 'Leave with Pay', 'Comp Off'];
const TYPE_COLOR = { 'Sick Leave': 'var(--coral)', 'Casual Leave': 'var(--indigo)', 'Leave with Pay': 'var(--grad-mid)', 'Comp Off': 'var(--coral-light)' };
const EMPTY = { type: 'Casual Leave', start_date: '', end_date: '', reason: '' };
const fmt = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const range = (l) => (l.start_date === l.end_date ? fmt(l.start_date) : `${fmt(l.start_date)} → ${fmt(l.end_date)}`);

// Same rule as the server: weekdays that are not (non-optional) holidays.
function workingDays(start, end, holidaySet) {
  if (!start || !end || end < start) return 0;
  let days = 0;
  for (let d = new Date(start); d <= new Date(end); d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidaySet.has(d.toISOString().slice(0, 10))) days++;
  }
  return days;
}

export default function Leaves({ me }) {
  const supervises = me.level !== 'employee';
  const [leaves, setLeaves] = useState(null);
  const [balances, setBalances] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [tab, setTab] = useState(null); // null until we know whether anything needs approval
  const [busy, setBusy] = useState(false);

  const load = () => api(`/leaves${supervises ? '?scope=all' : ''}`).then(setLeaves);
  const loadBalances = () => api('/dashboard').then((d) => setBalances(d.balances));
  useEffect(() => {
    load();
    loadBalances();
    api('/holidays').then(setHolidays);
  }, []);

  const holidaySet = useMemo(() => new Set(holidays.filter((h) => !h.optional).map((h) => h.date)), [holidays]);
  const days = workingDays(form.start_date, form.end_date, holidaySet);
  const balance = balances.find((b) => b.type === form.type)?.days ?? 0;
  const after = balance - days;
  const hasRange = form.start_date && form.end_date;
  const problem = !hasRange ? '' : form.end_date < form.start_date ? 'The end date cannot be earlier than the start date.' : days === 0 ? 'The selected period contains no working days. Weekends and public holidays are excluded.' : after < 0 ? `Insufficient balance: ${balance.toFixed(1)} day(s) of ${form.type} remaining.` : '';

  const set = (k) => (e) => {
    setSent(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/leaves', { method: 'POST', body: form });
      setForm({ ...EMPTY, type: form.type });
      setSent(true);
      await Promise.all([load(), loadBalances()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const update = async (id, status) => {
    setError('');
    try {
      await api(`/leaves/${id}`, { method: 'PATCH', body: { status } });
      await Promise.all([load(), loadBalances()]);
    } catch (err) {
      setError(err.message);
    }
  };

  const list = leaves ?? [];
  const toApprove = list.filter((l) => l.can_decide);
  const counts = {
    approve: toApprove.length,
    all: list.length,
    pending: list.filter((l) => l.status === 'pending').length,
    approved: list.filter((l) => l.status === 'approved').length,
    closed: list.filter((l) => ['rejected', 'cancelled'].includes(l.status)).length,
  };
  // Managers land on "Needs approval" when there is something to approve, everyone else on "All".
  const active = tab ?? (leaves && supervises && counts.approve > 0 ? 'approve' : 'all');
  const tabs = [
    ...(supervises ? [{ id: 'approve', label: 'Awaiting approval' }] : []),
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'approved', label: 'Approved' },
    { id: 'closed', label: 'Rejected / cancelled' },
  ];
  const shown = list.filter((l) => {
    if (active === 'approve') return l.can_decide;
    if (active === 'pending') return l.status === 'pending';
    if (active === 'approved') return l.status === 'approved';
    if (active === 'closed') return ['rejected', 'cancelled'].includes(l.status);
    return true;
  });

  return (
    <>
      <div className="balance-cards" role="radiogroup" aria-label="Leave type">
        {TYPES.map((t) => {
          const b = balances.find((x) => x.type === t)?.days ?? 0;
          return (
            <button key={t} type="button" role="radio" aria-checked={form.type === t} className={`bal-card ${form.type === t ? 'on' : ''}`} style={{ '--c': TYPE_COLOR[t] }} onClick={() => { setForm((f) => ({ ...f, type: t })); setSent(false); }}>
              <span className="bal-name">{t}</span>
              <span className="bal-days">{b.toFixed(1)}<small> days remaining</small></span>
              <span className="bal-bar"><i style={{ width: `${Math.min(b / 10, 1) * 100}%` }} /></span>
            </button>
          );
        })}
      </div>

      <div className="grid two-leave">
        <section className="card">
          <h3>Leave application: {form.type}</h3>
          <form onSubmit={submit} className="form">
            <div className="date-pair">
              <label>From
                <input type="date" required value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value, end_date: !f.end_date || f.end_date < e.target.value ? e.target.value : f.end_date }))} />
              </label>
              <label>To
                <input type="date" required value={form.end_date} min={form.start_date} onChange={set('end_date')} />
              </label>
            </div>

            <div className={`preview ${problem ? 'bad' : hasRange ? 'good' : ''}`} aria-live="polite">
              {!hasRange && <span className="muted">Select your dates to see the working days required and your resulting balance.</span>}
              {hasRange && !problem && (
                <>
                  <div><span className="muted">Working days</span><strong>{days}</strong></div>
                  <div><span className="muted">Current balance</span><strong>{balance.toFixed(1)}</strong></div>
                  <div><span className="muted">Balance after approval</span><strong>{after.toFixed(1)}</strong></div>
                </>
              )}
              {problem && <span>{problem}</span>}
            </div>

            <label>Reason
              <textarea rows={3} value={form.reason} onChange={set('reason')} placeholder="Optional: provide context for your approver" />
            </label>
            {error && <div className="error">{error}</div>}
            {sent && <div className="saved">Your request has been submitted and is awaiting approval.</div>}
            <button className="btn primary" type="submit" disabled={busy || !!problem || !hasRange}>Submit request</button>
          </form>
        </section>

        <section className="card">
          <div className="toolbar">
            <h3>{supervises ? (me.level === 'boss' ? 'All leave requests' : 'Team leave requests') : 'My leave requests'}</h3>
          </div>
          <div className="tabs scroll" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={active === t.id} className={active === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}<span className="count">{counts[t.id]}</span>
              </button>
            ))}
          </div>
          <div className="req-list">
            {shown.map((l) => (
              <article key={l.id} className={`req ${l.status}`} style={{ '--c': TYPE_COLOR[l.type] }}>
                <div className="req-main">
                  <div className="req-title">
                    {supervises && <strong>{l.user_id === me.id ? 'You' : l.employee}</strong>}
                    <span className={supervises ? 'muted' : ''}>{supervises ? '· ' : ''}{l.type}</span>
                  </div>
                  <div className="req-dates">{range(l)} <span className="muted">· {l.days} day{l.days > 1 ? 's' : ''}</span></div>
                  {l.reason && <div className="muted small">“{l.reason}”</div>}
                </div>
                <div className="req-side">
                  <span className={`chip ${l.status}`}>{l.status}</span>
                  <div className="row-actions">
                    {l.can_decide && (
                      <>
                        <button className="btn small" onClick={() => update(l.id, 'approved')}>Approve</button>
                        <button className="btn small" onClick={() => update(l.id, 'rejected')}>Reject</button>
                      </>
                    )}
                    {l.status === 'pending' && l.user_id === me.id && <button className="btn small" onClick={() => update(l.id, 'cancelled')}>Cancel</button>}
                  </div>
                </div>
              </article>
            ))}
            {leaves && shown.length === 0 && (
              <p className="empty">{active === 'approve' ? 'No requests are awaiting your approval.' : 'No leave requests found.'}</p>
            )}
            {!leaves && <p className="muted">Loading…</p>}
          </div>
        </section>
      </div>
    </>
  );
}
