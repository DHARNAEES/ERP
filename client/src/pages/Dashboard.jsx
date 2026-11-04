import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import Calendar from '../components/Calendar.jsx';
import { LABELS, when } from './Activity.jsx';

// Counts up from 0 to `value` so the numbers animate in.
function CountUp({ value, decimals = 0 }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min((now - start) / 900, 1);
      setN(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return n.toFixed(decimals);
}

const TYPE_COLOR = { 'Sick Leave': 'var(--coral)', 'Casual Leave': 'var(--indigo)', 'Leave with Pay': 'var(--grad-mid)', 'Comp Off': 'var(--coral-light)' };
const STATUS = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked' };
const pad = (n) => String(n).padStart(2, '0');
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—');
const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dur = (h) => `${Math.floor(h)}h ${pad(Math.round((h % 1) * 60) % 60)}m`;

// Donut of remaining leave days per type.
function Donut({ balances }) {
  const total = balances.reduce((s, b) => s + b.days, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <div className="donut" role="img" aria-label={`${total} leave days remaining`}>
        <svg viewBox="0 0 128 128" width="160" height="160">
          <circle cx="64" cy="64" r={r} className="donut-bg" />
          {total > 0 &&
            balances.filter((b) => b.days > 0).map((b) => {
              const len = (b.days / total) * c;
              const seg = <circle key={b.type} cx="64" cy="64" r={r} className="donut-seg" stroke={TYPE_COLOR[b.type]} strokeDasharray={`${Math.max(len - 3, 0)} ${c}`} strokeDashoffset={-offset} />;
              offset += len;
              return seg;
            })}
        </svg>
        <div className="donut-center"><strong><CountUp value={total} decimals={1} /></strong><span className="muted">days left</span></div>
      </div>
      <ul className="donut-legend">
        {balances.map((b) => (
          <li key={b.type}>
            <i style={{ background: TYPE_COLOR[b.type] }} />
            <span>{b.type}</span>
            <strong>{b.days.toFixed(1)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Dashboard({ me, go }) {
  const supervises = me.level !== 'employee';
  const isBoss = me.level === 'boss';
  const todayIso = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [att, setAtt] = useState([]);
  const [status, setStatus] = useState(null); // my work-status entries
  const [overview, setOverview] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [team, setTeam] = useState(null); // team work status for today
  const [activity, setActivity] = useState([]);
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const loadSupervisor = useCallback(() => {
    if (!supervises) return;
    api('/overview').then(setOverview);
    api('/leaves?scope=all').then((l) => setApprovals(l.filter((x) => x.can_decide)));
    api('/work-status?scope=team').then(setTeam);
    if (isBoss) api('/audit?limit=6').then(setActivity);
  }, [supervises, isBoss]);

  const loadAtt = () => api(`/attendance?month=${todayIso.slice(0, 7)}`).then(setAtt);

  useEffect(() => {
    Promise.all([api('/dashboard'), api('/holidays'), api('/leaves'), api(`/attendance?month=${todayIso.slice(0, 7)}`), api('/work-status')]).then(([d, h, l, a, w]) => {
      setData(d);
      setHolidays(h);
      setLeaves(l);
      setAtt(a);
      setStatus(w.entries);
    });
    loadSupervisor();
  }, [loadSupervisor]);

  if (!data) return <div className="muted">Loading…</div>;

  const myToday = att.find((r) => r.date === todayIso);
  const worked = myToday ? ((myToday.check_out ? new Date(myToday.check_out) : now) - new Date(myToday.check_in)) / 36e5 : 0;
  const postedToday = status?.some((e) => e.date === todayIso);
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const upcoming = holidays.filter((h) => h.date >= todayIso).slice(0, 4);
  const until = (iso) => {
    const n = Math.round((new Date(iso) - new Date(todayIso)) / 864e5);
    return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `in ${n} days`;
  };

  const punch = async (action) => {
    setError('');
    try {
      await api(`/attendance/${action}`, { method: 'POST' });
      await loadAtt();
      loadSupervisor();
    } catch (err) {
      setError(err.message);
    }
  };
  const decide = async (id, st) => {
    setError('');
    try {
      await api(`/leaves/${id}`, { method: 'PATCH', body: { status: st } });
      loadSupervisor();
    } catch (err) {
      setError(err.message);
    }
  };

  const attention = team?.entries.filter((e) => e.status !== 'on_track') ?? [];

  return (
    <>
      <section className="card hero">
        <div>
          <div className="muted">{now.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <h2>{greeting}, {me.name.split(' ')[0]}</h2>
          <div className="hero-chips">
            <button className={`pill ${myToday ? (myToday.check_out ? 'ok' : 'live') : 'warn'}`} onClick={() => go('attendance')}>
              {myToday ? (myToday.check_out ? `Day complete · ${dur(worked)}` : `Working · ${dur(worked)}`) : 'Not checked in'}
            </button>
            <button className={`pill ${postedToday ? 'ok' : 'warn'}`} onClick={() => go('workstatus')}>
              {postedToday ? 'Daily update submitted' : 'Daily update pending'}
            </button>
            {data.pending > 0 && <button className="pill" onClick={() => go('leaves')}>{data.pending} leave request{data.pending > 1 ? 's' : ''} pending</button>}
          </div>
          {error && <div className="error">{error}</div>}
        </div>
        <div className="hero-actions">
          {!myToday && <button className="btn primary big" onClick={() => punch('check-in')}>Check in</button>}
          {myToday && !myToday.check_out && <button className="btn big out" onClick={() => punch('check-out')}>Check out</button>}
          {!postedToday && <button className="btn" onClick={() => go('workstatus')}>Submit daily update</button>}
          <button className="btn" onClick={() => go('leaves')}>Apply for leave</button>
        </div>
      </section>

      {overview && (
        <>
          <h2 className="section-title">{overview.scope}</h2>
          <div className="grid four">
            <Stat label="People" value={overview.headcount} unit="active" />
            <Stat label="Checked in" value={overview.checkedInToday} unit="today" />
            <Stat label="On leave" value={overview.onLeaveToday} unit="today" />
            <button className="card stat stat-link" onClick={() => go('leaves')}>
              <div className="muted">Awaiting your approval</div>
              <div><span className="stat-value"><CountUp value={overview.pendingApprovals} /></span> <span className="muted">requests</span></div>
            </button>
          </div>

          <div className="grid two-even">
            <section className="card">
              <div className="toolbar"><h3>Pending approvals</h3>{approvals.length > 0 && <button className="btn small" onClick={() => go('leaves')}>View all</button>}</div>
              <div className="stack">
                {approvals.slice(0, 5).map((l) => (
                  <div key={l.id} className="row-card">
                    <div>
                      <strong>{l.employee}</strong> <span className="muted">· {l.type}</span>
                      <div className="muted small">{l.start_date === l.end_date ? shortDate(l.start_date) : `${shortDate(l.start_date)} → ${shortDate(l.end_date)}`} · {l.days} day{l.days > 1 ? 's' : ''}</div>
                    </div>
                    <div className="row-actions">
                      <button className="btn small" onClick={() => decide(l.id, 'approved')}>Approve</button>
                      <button className="btn small" onClick={() => decide(l.id, 'rejected')}>Reject</button>
                    </div>
                  </div>
                ))}
                {approvals.length === 0 && <p className="empty">No requests are awaiting your approval.</p>}
              </div>
            </section>

            <section className="card">
              <div className="toolbar"><h3>Today's work updates</h3><button className="btn small" onClick={() => go('workstatus')}>Open</button></div>
              {team && (
                <>
                  <div className="mini-stats">
                    <div><span className="muted">Submitted</span><strong>{team.entries.length}</strong></div>
                    <div><span className="muted">Requires attention</span><strong>{attention.length}</strong></div>
                    <div><span className="muted">Not yet submitted</span><strong>{team.missing.length}</strong></div>
                  </div>
                  <div className="stack">
                    {attention.slice(0, 4).map((e) => (
                      <div key={e.user_id} className="row-card">
                        <div>
                          <strong>{e.employee}</strong>
                          {e.blockers && <div className="blocker small">{e.blockers}</div>}
                        </div>
                        <span className={`chip ${e.status}`}>{STATUS[e.status]}</span>
                      </div>
                    ))}
                    {attention.length === 0 && <p className="empty">No blockers have been reported today.</p>}
                  </div>
                </>
              )}
            </section>
          </div>
        </>
      )}

      <h2 className="section-title">Personal summary</h2>
      <div className="grid four">
        <Stat label="Leave balance" value={data.totalBalance} decimals={1} unit="days" />
        <Stat label="Pending requests" value={data.pending} unit="awaiting" />
        <Stat label="Approved leave" value={data.approved} unit="this month" />
        <Stat label="Days present" value={att.length} unit="this month" />
      </div>

      <div className="grid two-even">
        <section className="card">
          <h3>Leave balance</h3>
          <Donut balances={data.balances} />
        </section>
        <section className="card">
          <div className="toolbar"><h3>Upcoming holidays</h3><button className="btn small" onClick={() => go('holidays')}>View all</button></div>
          <div className="stack">
            {upcoming.map((h) => (
              <div key={h.date} className="row-card">
                <div className="date-badge"><strong>{h.date.slice(8)}</strong><span>{new Date(`${h.date}T00:00:00Z`).toLocaleDateString('en', { month: 'short', timeZone: 'UTC' })}</span></div>
                <div className="grow">
                  <strong>{h.name}</strong>
                  <div className="muted small">{shortDate(h.date)}{h.optional ? ' · optional' : ''}</div>
                </div>
                <span className="chip pending">{until(h.date)}</span>
              </div>
            ))}
            {upcoming.length === 0 && <p className="empty">No upcoming holidays.</p>}
          </div>
        </section>
      </div>

      <div className="grid two">
        <section className="card">
          <h3>Leave and holiday calendar</h3>
          <Calendar holidays={holidays} leaves={leaves} />
        </section>
        <div className="col">
          <section className="card">
            <h3>Birthdays and work anniversaries</h3>
            <div className="stack">
              {data.birthdays.map((b) => (
                <div key={`b-${b.name}`} className="row-card"><span><strong>{b.name}</strong> <span className="muted small">birthday</span></span><span className="muted">{b.date.slice(5)}</span></div>
              ))}
              {data.anniversaries.map((a) => (
                <div key={`a-${a.name}`} className="row-card"><span><strong>{a.name}</strong> <span className="muted small">work anniversary</span></span><span className="muted">{a.date.slice(5)}</span></div>
              ))}
              {data.birthdays.length + data.anniversaries.length === 0 && <p className="empty">No birthdays or anniversaries this month.</p>}
            </div>
          </section>
          {isBoss && (
            <section className="card">
              <div className="toolbar"><h3>Recent activity</h3><button className="btn small" onClick={() => go('activity')}>View full log</button></div>
              <div className="stack">
                {activity.map((a) => (
                  <div key={a.id} className="row-card">
                    <div>
                      <strong>{a.actor ?? '—'}</strong> <span className="muted">{(LABELS[a.action] ?? a.action).toLowerCase()}</span>
                      {a.detail && <div className="muted small">{a.detail}</div>}
                    </div>
                    <span className="muted small nowrap">{when(a.at)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, unit, decimals = 0 }) {
  return (
    <div className="card stat">
      <div className="muted">{label}</div>
      <div>
        <span className="stat-value"><CountUp value={value} decimals={decimals} /></span> <span className="muted">{unit}</span>
      </div>
    </div>
  );
}
