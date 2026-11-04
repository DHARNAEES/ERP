import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Calendar from '../components/Calendar.jsx';

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

const TONE = { 'Sick Leave': 'red', 'Casual Leave': 'amber', 'Leave with Pay': 'green', 'Comp Off': 'violet' };

export default function Dashboard({ me, go }) {
  const [data, setData] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [overview, setOverview] = useState(null); // managers and the boss only
  const supervises = me.level !== 'employee';

  useEffect(() => {
    Promise.all([api('/dashboard'), api('/holidays'), api('/leaves'), supervises ? api('/overview') : null]).then(([d, h, l, o]) => {
      setData(d);
      setHolidays(h);
      setLeaves(l);
      setOverview(o);
    });
  }, [supervises]);

  if (!data) return <div className="muted">Loading…</div>;

  return (
    <>
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
          <h2 className="section-title">My own</h2>
        </>
      )}
      <div className="grid stats">
        <Stat label="Leave Balance" value={data.totalBalance} decimals={1} unit="days" />
        <Stat label="Pending Requests" value={data.pending} unit="awaiting" />
        <Stat label="Approved Leaves" value={data.approved} unit="this month" />
      </div>

      <div className="grid three">
        <section className="card">
          <h3>Leave Balance Breakdown</h3>
          {data.balances.map((b) => (
            <div key={b.type} className="row-pill">
              <span>{b.type}</span>
              <strong className={`tone-${TONE[b.type]}`}><CountUp value={b.days} decimals={1} /></strong>
            </div>
          ))}
        </section>
        <section className="card">
          <h3>Upcoming Birthdays</h3>
          {data.birthdays.length === 0 && <p className="muted">No upcoming birthdays this month</p>}
          {data.birthdays.map((b) => (
            <div key={b.name} className="row-pill">
              <span>{b.name}</span>
              <span className="muted">{b.date.slice(5)}</span>
            </div>
          ))}
        </section>
        <section className="card">
          <h3>Work Anniversaries</h3>
          {data.anniversaries.length === 0 && <p className="muted">No work anniversaries this month</p>}
          {data.anniversaries.map((a) => (
            <div key={a.name} className="row-pill">
              <span>{a.name}</span>
              <span className="muted">{a.date.slice(5)}</span>
            </div>
          ))}
        </section>
      </div>

      <div className="grid two">
        <section className="card">
          <h3>Leave &amp; Holiday Calendar</h3>
          <Calendar holidays={holidays} leaves={leaves} />
        </section>
        <section className="card">
          <h3>Quick Actions</h3>
          <div className="actions">
            <button className="btn primary" onClick={() => go('leaves')}>Apply for Leave</button>
            <button className="btn" onClick={() => go('holidays')}>View Holidays</button>
            <button className="btn" onClick={() => go('attendance')}>Mark Attendance</button>
          </div>
        </section>
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
