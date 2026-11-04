import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Holidays() {
  const [holidays, setHolidays] = useState([]);
  useEffect(() => {
    api('/holidays').then(setHolidays);
  }, []);

  return (
    <section className="card">
      <table className="rt">
        <thead>
          <tr><th>Date</th><th>Day</th><th>Holiday</th><th>Type</th></tr>
        </thead>
        <tbody>
          {holidays.map((h) => (
            <tr key={h.date}>
              <td data-label="Date">{h.date}</td>
              <td data-label="Day">{new Date(h.date).toLocaleString('en', { weekday: 'long', timeZone: 'UTC' })}</td>
              <td data-label="Holiday">{h.name}</td>
              <td data-label="Type">{h.optional ? 'Optional holiday' : 'Public holiday'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
