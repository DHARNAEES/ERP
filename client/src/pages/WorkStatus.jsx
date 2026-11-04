import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { roleLabel } from '../roles.js';

const STATUS = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked' };
const longDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const blank = { status: 'on_track', summary: '', plan: '', blockers: '', hours: '' };

// The last 8 days (today first) that an update may be posted for.
const recentDays = (today) =>
  Array.from({ length: 8 }, (_, i) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    return d.toISOString().slice(0, 10);
  });

function MyUpdate() {
  const [today, setToday] = useState(null);
  const [entries, setEntries] = useState([]);
  const [date, setDate] = useState(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api('/work-status').then((d) => {
      setToday(d.today);
      setEntries(d.entries);
      setDate((cur) => cur ?? d.today);
    });
  useEffect(() => {
    load();
  }, []);

  // Switching day loads that day's existing update (or a blank form).
  const existing = entries.find((e) => e.date === date);
  useEffect(() => {
    setForm(existing ? { status: existing.status, summary: existing.summary, plan: existing.plan ?? '', blockers: existing.blockers ?? '', hours: existing.hours ?? '' } : blank);
  }, [date, existing?.updated_at]);

  if (!today) return <div className="muted">Loading…</div>;
  const days = recentDays(today);
  const pick = (d) => {
    setDate(d);
    setSaved(false);
    setError('');
  };
  const set = (k) => (e) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api(`/work-status/${date}`, { method: 'PUT', body: form });
      await load();
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid two">
      <section className="card">
        <h3>{existing ? 'Edit your daily work update' : 'Submit your daily work update'}</h3>
        <form onSubmit={submit} className="form">
          <label>Day
            <select value={date} onChange={(e) => pick(e.target.value)}>
              {days.map((d, i) => (
                <option key={d} value={d}>{i === 0 ? `Today — ${shortDate(d)}` : i === 1 ? `Yesterday — ${shortDate(d)}` : shortDate(d)}{entries.some((x) => x.date === d) ? ' ✓' : ''}</option>
              ))}
            </select>
          </label>
          <fieldset className="seg">
            <legend>Progress status</legend>
            {Object.entries(STATUS).map(([value, label]) => (
              <label key={value} className={`seg-opt ${value} ${form.status === value ? 'on' : ''}`}>
                <input type="radio" name="status" value={value} checked={form.status === value} onChange={set('status')} />
                {label}
              </label>
            ))}
          </fieldset>
          <label>Work completed
            <textarea rows={4} required maxLength={2000} placeholder="Tasks completed, progress made and meetings attended" value={form.summary} onChange={set('summary')} />
          </label>
          <label>Plan for the next working day
            <textarea rows={2} maxLength={1000} placeholder="Planned tasks and priorities" value={form.plan} onChange={set('plan')} />
          </label>
          <label>Blockers or support required
            <textarea rows={2} maxLength={1000} placeholder="Describe any impediments. Leave blank if none." value={form.blockers} onChange={set('blockers')} />
          </label>
          <label>Hours worked (optional)
            <input type="number" min="0" max="24" step="0.5" value={form.hours} onChange={set('hours')} />
          </label>
          {error && <div className="error">{error}</div>}
          {saved && <div className="saved">Your update for {longDate(date)} has been saved.</div>}
          <button className="btn primary" type="submit" disabled={busy}>{existing ? 'Save changes' : 'Submit update'}</button>
        </form>
      </section>

      <section className="card">
        <h3>Recent updates</h3>
        <div className="feed">
          {entries.map((e) => (
            <article key={e.date} className={`feed-item ${e.date === date ? 'current' : ''}`}>
              <header>
                <strong>{longDate(e.date)}</strong>
                <span className={`chip ${e.status}`}>{STATUS[e.status]}</span>
              </header>
              <p>{e.summary}</p>
              {e.plan && <p className="muted"><b>Next:</b> {e.plan}</p>}
              {e.blockers && <p className="blocker"><b>Blockers:</b> {e.blockers}</p>}
              <footer className="muted">
                {e.hours != null && <span>{e.hours} h</span>}
                {days.includes(e.date) && <button className="btn small ghost" onClick={() => pick(e.date)}>Edit</button>}
              </footer>
            </article>
          ))}
          {entries.length === 0 && <p className="muted">No updates have been submitted yet.</p>}
        </div>
      </section>
    </div>
  );
}

function TeamUpdates({ me }) {
  const [data, setData] = useState(null);
  const [date, setDate] = useState(null);

  useEffect(() => {
    api(`/work-status?scope=team${date ? `&date=${date}` : ''}`).then((d) => {
      setData(d);
      setDate((cur) => cur ?? d.today);
    });
  }, [date]);

  if (!data) return <div className="muted">Loading…</div>;
  const total = data.entries.length + data.missing.length;
  const pct = total ? Math.round((data.entries.length / total) * 100) : 0;
  const flagged = data.entries.filter((e) => e.status !== 'on_track').length;

  return (
    <>
      <section className="card">
        <div className="toolbar">
          <h3>{me.level === 'boss' ? 'Organisation updates' : 'Team updates'}</h3>
          <input type="date" max={data.today} value={date ?? data.today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
        </div>
        <div className="mini-stats">
          <div><span className="muted">Submitted</span><strong>{data.entries.length} of {total}</strong></div>
          <div><span className="muted">Requires attention</span><strong>{flagged}</strong></div>
          <div><span className="muted">Not yet submitted</span><strong>{data.missing.length}</strong></div>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Updates submitted"><div style={{ width: `${pct}%` }} /></div>
        {data.missing.length > 0 && (
          <p className="pending-list"><span className="muted">Not yet submitted (excluding approved leave): </span>{data.missing.map((m) => <span key={m.id} className="chip pending">{m.name}</span>)}</p>
        )}
      </section>

      <div className="feed wide">
        {data.entries.map((e) => (
          <article key={e.user_id} className="card feed-item">
            <header>
              <div><strong>{e.employee}</strong> <span className="muted">· {roleLabel(e.role)}</span></div>
              <span className={`chip ${e.status}`}>{STATUS[e.status]}</span>
            </header>
            <p>{e.summary}</p>
            {e.plan && <p className="muted"><b>Next:</b> {e.plan}</p>}
            {e.blockers && <p className="blocker"><b>Blockers:</b> {e.blockers}</p>}
            {e.hours != null && <footer className="muted">{e.hours} h</footer>}
          </article>
        ))}
        {data.entries.length === 0 && <p className="muted">No updates have been submitted for {longDate(data.date)}.</p>}
      </div>
    </>
  );
}

export default function WorkStatus({ me }) {
  const supervises = me.level !== 'employee';
  const [tab, setTab] = useState('mine');
  return (
    <>
      {supervises && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My update</button>
          <button role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'on' : ''} onClick={() => setTab('team')}>{me.level === 'boss' ? 'Organisation' : 'My team'}</button>
        </div>
      )}
      {tab === 'mine' ? <MyUpdate /> : <TeamUpdates me={me} />}
    </>
  );
}
