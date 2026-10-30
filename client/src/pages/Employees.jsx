import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api('/employees').then(setEmployees);
  }, []);

  const q = query.trim().toLowerCase();
  const shown = employees.filter((e) => !q || `${e.name} ${e.email} ${e.role}`.toLowerCase().includes(q));

  return (
    <section className="card">
      <div className="toolbar">
        <h3>Employee Directory</h3>
        <input type="search" placeholder="Search employees" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search employees" />
      </div>
      <table>
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr>
        </thead>
        <tbody>
          {shown.map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td>
              <td>{e.email}</td>
              <td className="capitalize">{e.role}</td>
              <td>{e.join_date}</td>
            </tr>
          ))}
          {shown.length === 0 && (
            <tr><td colSpan={4} className="muted">No employees match.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
