import { useState } from 'react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');

export default function Calendar({ holidays, leaves }) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  });

  const events = {};
  for (const h of holidays) events[h.date] = { label: h.name, kind: h.optional ? 'optional' : 'holiday' };
  for (const l of leaves.filter((l) => ['approved', 'pending'].includes(l.status))) {
    for (let d = new Date(l.start_date); d <= new Date(l.end_date); d.setUTCDate(d.getUTCDate() + 1)) {
      events[d.toISOString().slice(0, 10)] = { label: l.type.split(' ')[0].toLowerCase(), kind: l.status };
    }
  }

  const first = new Date(cursor.y, cursor.m, 1).getDay();
  const total = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  const shift = (delta) => {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };
  const today = new Date();

  return (
    <div>
      <div className="cal-head">
        <strong>{new Date(cursor.y, cursor.m).toLocaleString('en', { month: 'long', year: 'numeric' })}</strong>
        <div>
          <button className="btn ghost" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <button className="btn ghost" onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>Today</button>
          <button className="btn ghost" onClick={() => shift(1)} aria-label="Next month">›</button>
        </div>
      </div>
      <div className="cal-grid">
        {DAYS.map((d) => (
          <div key={d} className="cal-dow">{d}</div>
        ))}
        {cells.map((day, i) => {
          const ev = day && events[`${cursor.y}-${pad(cursor.m + 1)}-${pad(day)}`];
          const isToday = day && today.getFullYear() === cursor.y && today.getMonth() === cursor.m && today.getDate() === day;
          return (
            <div key={i} className={`cal-cell ${day ? '' : 'empty'} ${isToday ? 'today' : ''}`}>
              {day}
              {ev && <div className={`chip ${ev.kind}`}>{ev.label}</div>}
            </div>
          );
        })}
      </div>
      <div className="legend">
        <span><i className="chip holiday" /> Holiday</span>
        <span><i className="chip optional" /> Optional Holiday</span>
        <span><i className="chip approved" /> Approved Leave</span>
        <span><i className="chip pending" /> Pending Leave</span>
      </div>
    </div>
  );
}
