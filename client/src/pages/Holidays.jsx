import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Holidays() {
  const [holidays, setHolidays] = useState([]);
  useEffect(() => {
    api('/holidays').then(setHolidays);
  }, []);

  return (
    <section className="card">
      <table>
        <thead>
          <tr><th>Date</th><th>Day</th><th>Holiday</th><th>Type</th></tr>
        </thead>
        <tbody>
          {holidays.map((h) => (
            <tr key={h.date}>
              <td>{h.date}</td>
              <td>{new Date(h.date).toLocaleString('en', { weekday: 'long', timeZone: 'UTC' })}</td>
              <td>{h.name}</td>
              <td>{h.optional ? 'Optional' : 'Fixed'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
