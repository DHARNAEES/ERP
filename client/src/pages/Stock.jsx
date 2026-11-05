import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const EMPTY = { code: '', name: '', category: '', make: '', rack: '', vendor: '', unit_price: '', qty: '', min_qty: '' };

export default function Stock({ me }) {
  const canEdit = me.level !== 'employee';
  const [tab, setTab] = useState('products');
  const [data, setData] = useState(null);
  const [log, setLog] = useState([]);
  const [f, setF] = useState({ q: '', category: '', make: '', status: '', rack: '', vendor: '', include_out: false });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [adjust, setAdjust] = useState(null); // { id, name, change, reason }
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v === true ? '1' : v);
    api(`/stock?${qs}`).then(setData).catch((e) => setError(e.message));
  }, [f]);

  useEffect(() => {
    const t = setTimeout(load, f.q ? 250 : 0); // debounce typing in the search box
    return () => clearTimeout(t);
  }, [load, f.q]);

  useEffect(() => {
    if (tab === 'log') api('/stock/log').then(setLog).catch((e) => setError(e.message));
  }, [tab]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setFormField = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const addProduct = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api('/stock/products', { method: 'POST', body: form });
      setForm(EMPTY);
      setAdding(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveAdjust = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api(`/stock/products/${adjust.id}/adjust`, { method: 'POST', body: { change: adjust.change, reason: adjust.reason } });
      setAdjust(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const exportCsv = () => {
    const rows = [['Code', 'Name', 'Category', 'Make', 'Rack', 'Vendor', 'Available', 'Unit price', 'Value', 'Status']];
    for (const p of data.products) rows.push([p.code, p.name, p.category, p.make, p.rack, p.vendor, p.qty, p.unit_price, p.value, p.status]);
    // Prefix cells that start with a formula character so spreadsheets treat them as text.
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const blob = new Blob([rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'inventory.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!data) return <div className="card muted">{error || 'Loading stock…'}</div>;
  const { summary, options } = data;
  const cards = [
    ['Total products', num(summary.totalProducts)],
    ['Total available', num(summary.totalAvailable)],
    ['Inventory value', money(summary.inventoryValue)],
    ['Low stock', num(summary.lowStock)],
    ['Out of stock', num(summary.outOfStock)],
  ];

  return (
    <div className="stock">
      <div className="grid five">
        {cards.map(([label, value]) => (
          <section key={label} className="card stat">
            <div className="muted small">{label}</div>
            <div className="stat-value">{value}</div>
          </section>
        ))}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <section className="card">
        <div className="toolbar">
          <div className="seg">
            <button className={`btn ${tab === 'products' ? 'primary' : ''}`} onClick={() => setTab('products')}>Products</button>
            <button className={`btn ${tab === 'log' ? 'primary' : ''}`} onClick={() => setTab('log')}>Stock Log</button>
          </div>
          {tab === 'products' && (
            <div className="seg">
              {canEdit && <button className="btn" onClick={() => setAdding((a) => !a)}>{adding ? 'Close' : 'Add product'}</button>}
              <button className="btn" onClick={exportCsv}>Export inventory</button>
            </div>
          )}
        </div>

        {tab === 'products' && (
          <>
            {adding && (
              <form className="fields stock-form" onSubmit={addProduct}>
                <label>Code<input value={form.code} onChange={setFormField('code')} required maxLength={60} /></label>
                <label>Name<input value={form.name} onChange={setFormField('name')} required maxLength={200} /></label>
                <label>Category<input value={form.category} onChange={setFormField('category')} maxLength={80} /></label>
                <label>Make<input value={form.make} onChange={setFormField('make')} maxLength={80} /></label>
                <label>Rack<input value={form.rack} onChange={setFormField('rack')} maxLength={40} /></label>
                <label>Vendor<input value={form.vendor} onChange={setFormField('vendor')} maxLength={120} /></label>
                <label>Unit price (₹)<input type="number" min="0" step="0.01" value={form.unit_price} onChange={setFormField('unit_price')} /></label>
                <label>Opening quantity<input type="number" min="0" value={form.qty} onChange={setFormField('qty')} /></label>
                <label>Low-stock level<input type="number" min="0" value={form.min_qty} onChange={setFormField('min_qty')} /></label>
                <div className="wide"><button className="btn primary" type="submit">Save product</button></div>
              </form>
            )}

            <div className="form-row stock-filters">
              <input type="search" placeholder="Search by name, code, make, category" value={f.q} onChange={set('q')} aria-label="Search stock" />
              <select value={f.category} onChange={set('category')} aria-label="Category"><option value="">Category</option>{options.categories.map((o) => <option key={o}>{o}</option>)}</select>
              <select value={f.make} onChange={set('make')} aria-label="Make"><option value="">Make</option>{options.makes.map((o) => <option key={o}>{o}</option>)}</select>
              <select value={f.status} onChange={set('status')} aria-label="Status">
                <option value="">Status</option><option value="in">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option>
              </select>
              <select value={f.rack} onChange={set('rack')} aria-label="Rack"><option value="">Rack</option>{options.racks.map((o) => <option key={o}>{o}</option>)}</select>
              <select value={f.vendor} onChange={set('vendor')} aria-label="Vendor"><option value="">Vendor</option>{options.vendors.map((o) => <option key={o}>{o}</option>)}</select>
              <label className="check">
                <input type="checkbox" checked={f.include_out} onChange={set('include_out')} /> Show out of stock
                {!f.include_out && data.hiddenOut > 0 && <span className="muted small"> ({data.hiddenOut} hidden)</span>}
              </label>
            </div>

            <div className="stock-list">
              {data.products.map((p) => (
                <div key={p.id} className="row-card stock-row">
                  <div className="stock-main">
                    <strong>{p.code}</strong>
                    <div className="stock-tags">
                      {p.make && <span className="tag blue">{p.make}</span>}
                      <span className="tag">{p.name}</span>
                      {p.category && <span className="tag">{p.category}</span>}
                      {p.rack && <span className="tag green">{p.rack}: {num(p.qty)}</span>}
                    </div>
                  </div>
                  <div className="stock-side">
                    <span className={`tag big ${p.status}`}>{p.status === 'out' ? 'Out of stock' : `${num(p.qty)} available`}</span>
                    <span className="tag big violet">{money(p.value)}</span>
                    {p.status === 'low' && <span className="chip pending">Low</span>}
                    {canEdit && <button className="btn small" onClick={() => setAdjust({ id: p.id, name: p.name, change: '', reason: '' })}>Adjust</button>}
                  </div>
                </div>
              ))}
              {data.products.length === 0 && <p className="empty">No products match these filters.</p>}
            </div>
          </>
        )}

        {tab === 'log' && (
          <table className="rt">
            <thead><tr><th>When</th><th>Product</th><th>Change</th><th>Balance</th><th>Reason</th><th>By</th></tr></thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id}>
                  <td data-label="When">{new Date(`${l.at.replace(' ', 'T')}Z`).toLocaleString('en-IN')}</td>
                  <td data-label="Product">{l.code} · {l.name}</td>
                  <td data-label="Change"><strong className={l.change > 0 ? 'pos' : 'neg'}>{l.change > 0 ? '+' : ''}{num(l.change)}</strong></td>
                  <td data-label="Balance">{num(l.qty_after)}</td>
                  <td data-label="Reason">{l.reason}</td>
                  <td data-label="By">{l.actor ?? '—'}</td>
                </tr>
              ))}
              {log.length === 0 && <tr><td colSpan="6" className="empty">No stock movements yet.</td></tr>}
            </tbody>
          </table>
        )}
      </section>

      {adjust && (
        <div className="modal-scrim" onClick={() => setAdjust(null)}>
          <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={saveAdjust}>
            <h3>Adjust stock</h3>
            <p className="muted">{adjust.name}</p>
            <div className="fields">
              <label>Change (use a minus to remove)<input type="number" step="any" required autoFocus value={adjust.change} onChange={(e) => setAdjust({ ...adjust, change: e.target.value })} /></label>
              <label>Reason<input required maxLength={200} value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} /></label>
            </div>
            <div className="form-row" style={{ marginTop: 14 }}>
              <button className="btn primary" type="submit">Save</button>
              <button className="btn" type="button" onClick={() => setAdjust(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
