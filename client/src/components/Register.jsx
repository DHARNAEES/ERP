import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

export const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pad = (n) => String(n).padStart(2, '0');
const monthRange = (y, m) => {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
};

// A reusable register page (summary cards, filters, table, add/edit form, CSV export).
// `config` describes one module; the server enforces permissions and validation.
export default function Register({ config }) {
  const { endpoint, dated } = config;
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [filters, setFilters] = useState({ q: '' });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | {} (new) | row
  const [form, setForm] = useState({});
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(25);

  const query = useMemo(() => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
    if (dated) {
      const { from, to } = monthRange(ym.y, ym.m);
      qs.set('from', filters.from || from);
      qs.set('to', filters.to || to);
    }
    return qs.toString();
  }, [filters, ym, dated]);

  const load = useCallback(() => {
    api(`/erp/${endpoint}?${query}`).then(setData).catch((e) => setError(e.message));
  }, [endpoint, query]);

  useEffect(() => {
    const t = setTimeout(load, filters.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, filters.q]);
  useEffect(() => setPage(0), [query, perPage]);

  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const shiftMonth = (d) => {
    setFilters((f) => ({ ...f, from: '', to: '' }));
    setYm(({ y, m }) => {
      const t = new Date(y, m + d, 1);
      return { y: t.getFullYear(), m: t.getMonth() };
    });
  };
  const monthLabel = new Date(ym.y, ym.m, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const openForm = (row) => {
    setError('');
    const init = {};
    for (const f of config.form) init[f.key] = row?.[f.key] ?? f.default ?? '';
    setForm(init);
    setEditing(row ?? {});
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (editing.id) await api(`/erp/${endpoint}/${editing.id}`, { method: 'PATCH', body: form });
      else await api(`/erp/${endpoint}`, { method: 'POST', body: form });
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete ${row[config.idKey] ?? 'this record'}? This cannot be undone.`)) return;
    try {
      await api(`/erp/${endpoint}/${row.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const exportCsv = () => {
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`; // stop spreadsheets running formulas
      return `"${s.replace(/"/g, '""')}"`;
    };
    const cols = config.columns.filter((c) => c.key);
    const lines = [cols.map((c) => cell(c.label)).join(',')];
    for (const r of data.rows) lines.push(cols.map((c) => cell(c.csv ? c.csv(r) : r[c.key])).join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `${endpoint}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!data) return <div className="card muted">{error || 'Loading…'}</div>;
  const rows = data.rows;
  const shown = rows.slice(page * perPage, page * perPage + perPage);
  const cards = config.cards(data.summary);
  const opts = data.options ?? {};

  return (
    <div className="register">
      <section className="card reg-head">
        <div>
          <h2>{config.title} <span className="count">{rows.length}</span></h2>
          <p className="muted">{config.subtitle}</p>
        </div>
        <div className="seg">
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
          {data.canWrite && <button className="btn primary" onClick={() => openForm(null)}>{config.addLabel}</button>}
        </div>
      </section>

      {config.note && <section className="card muted small">{config.note(data)}</section>}

      <div className="grid five reg-cards">
        {cards.map((c) => (
          <section key={c.label} className="card stat">
            <div className="muted small caps">{c.label}</div>
            <div className={`stat-value ${c.tone ?? ''}`}>{c.value}</div>
            {c.hint && <div className="muted small">{c.hint}</div>}
          </section>
        ))}
      </div>

      {error && !editing && <p className="error" role="alert">{error}</p>}

      <section className="card">
        <div className="form-row reg-filters">
          {dated && (
            <div className="month-nav">
              <button className="btn small" aria-label="Previous month" onClick={() => shiftMonth(-1)}>‹</button>
              <strong>{monthLabel}</strong>
              <button className="btn small" aria-label="Next month" onClick={() => shiftMonth(1)}>›</button>
            </div>
          )}
          <input type="search" placeholder={config.searchPlaceholder} value={filters.q} onChange={setF('q')} aria-label="Search" />
          {config.filters.map((f) => (
            <select key={f.key} value={filters[f.key] ?? ''} onChange={setF(f.key)} aria-label={f.label}>
              <option value="">{f.label}</option>
              {f.key === 'engineer_id' || f.key === 'owner_id'
                ? (opts.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)
                : (f.options ?? opts[f.key] ?? []).map((o) => <option key={o}>{o}</option>)}
            </select>
          ))}
          {config.mine && (
            <label className="check"><input type="checkbox" checked={filters.mine === '1'} onChange={(e) => setFilters((f) => ({ ...f, mine: e.target.checked ? '1' : '' }))} /> Mine</label>
          )}
          {dated && <span className="muted small push-right">All values exclude GST.</span>}
        </div>

        <div className="table-wrap">
          <table className="rt reg-table">
            <thead>
              <tr><th>S. No.</th>{config.columns.map((c) => <th key={c.label} className={c.right ? 'num' : ''}>{c.label}</th>)}{data.canWrite && <th>Actions</th>}</tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.id}>
                  <td data-label="S. No.">{page * perPage + i + 1}</td>
                  {config.columns.map((c) => (
                    <td key={c.label} data-label={c.label} className={c.right ? 'num' : ''}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>
                  ))}
                  {data.canWrite && (
                    <td data-label="Actions">
                      <button className="btn small" onClick={() => openForm(r)}>Edit</button>{' '}
                      {config.canDelete !== false && data.canDelete !== false && <button className="btn small danger" onClick={() => remove(r)}>Delete</button>}
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={config.columns.length + 2} className="empty">{config.empty ?? 'Nothing here yet.'}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="pager">
          <span className="muted small">Rows per page</span>
          <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} aria-label="Rows per page">
            {[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}
          </select>
          <span className="muted small">{rows.length ? `${page * perPage + 1}–${Math.min((page + 1) * perPage, rows.length)} of ${rows.length}` : '0 of 0'}</span>
          <button className="btn small" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">‹</button>
          <button className="btn small" disabled={(page + 1) * perPage >= rows.length} onClick={() => setPage((p) => p + 1)} aria-label="Next page">›</button>
        </div>
      </section>

      {editing && (
        <div className="modal-scrim" onClick={() => setEditing(null)}>
          <form className="card modal wide-modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <h3>{editing.id ? 'Edit' : config.addLabel}</h3>
            <div className="fields">
              {config.form.map((f) => (
                <label key={f.key} className={f.wide ? 'wide' : ''}>
                  {f.label}
                  {f.type === 'select' ? (
                    <select value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} required={f.required}>
                      {!f.required && <option value="">—</option>}
                      {(f.key === 'owner_id' || f.key === 'engineer_id' ? (opts.people ?? []).map((p) => [p.id, p.name]) : f.options.map((o) => [o, o])).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  ) : (
                    <input
                      type={f.type ?? 'text'}
                      min={f.type === 'number' ? 0 : undefined}
                      step={f.type === 'number' ? '0.01' : undefined}
                      required={f.required}
                      maxLength={f.type === 'number' || f.type === 'date' ? undefined : 200}
                      value={form[f.key]}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  )}
                </label>
              ))}
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="form-row" style={{ marginTop: 14 }}>
              <button className="btn primary" type="submit">Save</button>
              <button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
