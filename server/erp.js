// Business registers: customer POs, vendor (supplier) POs, sales orders and projects.
// One small table-driven module serves all four, so validation, access rules and the audit
// trail are identical everywhere. Column names come from the MODULES table below, never from input.
import { db } from './db.js';

const TYPES = ['Supply', 'Project', 'Service'];
const text = (max, req = false) => ({ t: 'text', max, req });
const num = (req = false) => ({ t: 'num', req });
const date = (req = false) => ({ t: 'date', req });
const oneOf = (vals, def) => ({ t: 'enum', vals, def });
const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);

export const MODULES = {
  'customer-pos': {
    table: 'customer_pos',
    createdBy: true,
    view: ['manager', 'boss'],
    write: ['manager', 'boss'],
    dateKey: 'po_date',
    search: ['customer', 'po_no', 'project_code'],
    filters: ['customer', 'status', 'type'],
    fields: {
      customer: text(150, true), po_no: text(80, true), po_date: date(true), value: num(true),
      type: oneOf(TYPES, 'Supply'), project_code: text(60), status: oneOf(['Open', 'Processed', 'On hold', 'Cancelled'], 'Open'), invoiced: num(),
    },
    summary: (rows) => {
      const live = rows.filter((r) => r.status !== 'Cancelled');
      return {
        orders: rows.length,
        total: sum(rows, 'value'),
        live: sum(live, 'value'),
        invoiced: sum(live, 'invoiced'),
        onHold: sum(rows.filter((r) => r.status === 'On hold'), 'value'),
      };
    },
  },
  'vendor-pos': {
    table: 'vendor_pos',
    createdBy: true,
    view: ['manager', 'boss'],
    write: ['manager', 'boss'],
    dateKey: 'po_date',
    search: ['vendor', 'po_no', 'project_code'],
    filters: ['vendor', 'status', 'type'],
    fields: {
      vendor: text(150, true), po_no: text(80, true), po_date: date(true), value: num(true),
      type: oneOf(TYPES, 'Supply'), project_code: text(60), status: oneOf(['Open', 'Processed', 'Invoiced', 'Cancelled'], 'Open'), paid: num(),
    },
    derive: (r) => ({ balance: Math.max(r.value - r.paid, 0), payment: r.paid <= 0 ? 'Unpaid' : r.paid >= r.value ? 'Paid' : 'Partial' }),
    summary: (rows) => {
      const live = rows.filter((r) => r.status !== 'Cancelled');
      return {
        orders: rows.length,
        total: sum(live, 'value'),
        paid: sum(live, 'paid'),
        outstanding: live.reduce((s, r) => s + Math.max(r.value - r.paid, 0), 0),
        unpaid: live.filter((r) => r.paid < r.value).length,
      };
    },
  },
  sales: {
    table: 'sales_orders',
    view: ['employee', 'manager', 'boss'],
    write: ['employee', 'manager', 'boss'], // employees only on their own orders
    ownerKey: 'engineer_id',
    dateKey: 'po_date',
    search: ['customer', 'po_no', 'invoice_no', 'project_code'],
    filters: ['customer', 'type', 'engineer_id'],
    fields: {
      customer: text(150, true), po_no: text(80, true), po_date: date(true), value: num(true), type: oneOf(TYPES, 'Supply'),
      project_code: text(60), invoice_no: text(80), invoice_date: date(), invoice_value: num(), purchase_cost: num(),
    },
    join: 'LEFT JOIN users e ON e.id = t.engineer_id',
    extra: 'e.name AS engineer',
    derive: (r) => ({ profit: r.value - r.purchase_cost }),
    summary: (rows) => ({
      orders: rows.length,
      poValue: sum(rows, 'value'),
      invoiced: sum(rows, 'invoice_value'),
      purchase: sum(rows, 'purchase_cost'),
      profit: sum(rows, 'value') - sum(rows, 'purchase_cost'),
    }),
  },
  projects: {
    table: 'projects',
    view: ['employee', 'manager', 'boss'],
    write: ['manager', 'boss'],
    search: ['code', 'name', 'customer'],
    filters: ['status', 'customer'],
    fields: {
      code: text(60, true), name: text(200, true), customer: text(150),
      status: oneOf(['Active', 'Completed', 'On hold', 'Cancelled'], 'Active'), owner_id: { t: 'int' }, due_date: date(),
    },
    join: 'LEFT JOIN users e ON e.id = t.owner_id',
    extra: 'e.name AS owner',
    summary: (rows, ctx) => {
      const weekEnd = new Date(`${ctx.today}T00:00:00Z`);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
      const end = weekEnd.toISOString().slice(0, 10);
      const active = rows.filter((r) => r.status === 'Active');
      return {
        total: rows.length,
        active: active.length,
        completed: rows.filter((r) => r.status === 'Completed').length,
        overdue: active.filter((r) => r.due_date && r.due_date < ctx.today).length,
        dueThisWeek: active.filter((r) => r.due_date && r.due_date >= ctx.today && r.due_date <= end).length,
      };
    },
  },
};

export function registerErp(app, { audit, levelOf, scopeIds, isRealDate, todayStr }) {
  const forbidden = (res) => res.status(403).json({ error: 'You do not have permission to perform this action' });
  const getModule = (req, res, next) => {
    const mod = Object.hasOwn(MODULES, req.params.mod) ? MODULES[req.params.mod] : null;
    if (!mod) return res.status(404).json({ error: 'Not found' });
    req.mod = mod;
    req.modName = req.params.mod;
    next();
  };

  // Which rows this user may see/change. Registers with an owner column are scoped by reporting line.
  const scopeClause = (mod, user) => {
    if (!mod.ownerKey || levelOf(user.role) === 'boss') return { sql: '', args: [] };
    const ids = scopeIds(user);
    return { sql: `t.${mod.ownerKey} IN (${ids.map(() => '?').join(',')})`, args: ids };
  };

  function parse(mod, body, { partial }) {
    const out = {};
    for (const [key, f] of Object.entries(mod.fields)) {
      if (body[key] === undefined) {
        if (!partial && f.req) return { error: `${key.replace(/_/g, ' ')} is required` };
        continue;
      }
      const raw = body[key] == null ? '' : String(body[key]).trim();
      const label = key.replace(/_/g, ' ');
      if (raw === '') {
        if (f.req) return { error: `${label} is required` };
        if (f.t === 'enum') out[key] = f.def;
        else out[key] = f.t === 'num' ? 0 : null;
        continue;
      }
      if (f.t === 'text') {
        if (raw.length > f.max) return { error: `${label} is too long (max ${f.max})` };
        out[key] = raw;
      } else if (f.t === 'num') {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n >= 1e12) return { error: `${label} must be zero or more` };
        out[key] = n;
      } else if (f.t === 'int') {
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) return { error: `Invalid ${label}` };
        out[key] = n;
      } else if (f.t === 'date') {
        if (!isRealDate(raw) || raw < '2000-01-01' || raw > '2100-12-31') return { error: `Enter a valid ${label}` };
        out[key] = raw;
      } else if (f.t === 'enum') {
        if (!f.vals.includes(raw)) return { error: `Invalid ${label}` };
        out[key] = raw;
      }
    }
    return { out };
  }

  const fetchRow = (mod, id) =>
    db.prepare(`SELECT t.*${mod.extra ? `, ${mod.extra}` : ''} FROM ${mod.table} t ${mod.join ?? ''} WHERE t.id = ?`).get(id);
  const present = (mod, r) => ({ ...r, ...(mod.derive ? mod.derive(r) : {}) });

  app.get('/api/erp/:mod', getModule, (req, res) => {
    const { mod, user } = req;
    if (!mod.view.includes(levelOf(user.role))) return forbidden(res);
    const where = [];
    const args = [];
    const scope = scopeClause(mod, user);
    if (scope.sql) {
      where.push(scope.sql);
      args.push(...scope.args);
    }
    const { from, to, q } = req.query;
    if (mod.dateKey) {
      if (isRealDate(String(from ?? ''))) { where.push(`t.${mod.dateKey} >= ?`); args.push(from); }
      if (isRealDate(String(to ?? ''))) { where.push(`t.${mod.dateKey} <= ?`); args.push(to); }
    }
    if (q) {
      const like = `%${String(q).slice(0, 100).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      where.push(`(${mod.search.map((c) => `t.${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
      args.push(...mod.search.map(() => like));
    }
    for (const key of mod.filters) {
      if (req.query[key]) { where.push(`t.${key} = ?`); args.push(req.query[key]); }
    }
    if (req.modName === 'projects' && req.query.mine === '1') { where.push('t.owner_id = ?'); args.push(user.id); }
    const rows = db
      .prepare(
        `SELECT t.*${mod.extra ? `, ${mod.extra}` : ''} FROM ${mod.table} t ${mod.join ?? ''}
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.${mod.dateKey ?? 'created_at'} DESC, t.id DESC LIMIT 1000`,
      )
      .all(...args);
    const options = {};
    for (const key of mod.filters) {
      if (key === 'engineer_id') continue;
      options[key] = db.prepare(`SELECT DISTINCT t.${key} AS v FROM ${mod.table} t ${scope.sql ? `WHERE ${scope.sql}` : ''} ORDER BY v`).all(...scope.args).map((r) => r.v).filter(Boolean);
    }
    if (req.modName === 'sales' || req.modName === 'projects') {
      options.people = db.prepare(`SELECT id, name FROM users WHERE active = 1 AND id IN (${scopeIds(user).map(() => '?').join(',')}) ORDER BY name`).all(...scopeIds(user));
    }
    res.json({
      rows: rows.map((r) => present(mod, r)),
      summary: mod.summary(rows, { today: todayStr() }),
      options,
      canWrite: mod.write.includes(levelOf(user.role)),
      canDelete: levelOf(user.role) !== 'employee',
    });
  });

  app.post('/api/erp/:mod', getModule, (req, res) => {
    const { mod, user } = req;
    if (!mod.write.includes(levelOf(user.role))) return forbidden(res);
    const parsed = parse(mod, req.body ?? {}, { partial: false });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const data = parsed.out;
    for (const [k, f] of Object.entries(mod.fields)) if (data[k] === undefined) data[k] = f.t === 'enum' ? f.def : f.t === 'num' ? 0 : null;
    if (mod.ownerKey) {
      const wanted = Number(req.body?.[mod.ownerKey]) || user.id;
      if (!scopeIds(user).includes(wanted)) return forbidden(res);
      data[mod.ownerKey] = wanted;
    } else if (mod.createdBy) {
      data.created_by = user.id;
    }
    if (req.modName === 'projects' && data.owner_id && !scopeIds(user).includes(data.owner_id)) return forbidden(res);
    const keys = Object.keys(data);
    try {
      const info = db.prepare(`INSERT INTO ${mod.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => data[k]));
      audit(user.id, `${req.modName}_created`, String(data.po_no ?? data.code ?? info.lastInsertRowid));
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'That code is already in use' });
      throw err;
    }
  });

  const loadOwned = (req, res) => {
    const { mod, user } = req;
    if (!mod.write.includes(levelOf(user.role))) return forbidden(res);
    const row = fetchRow(mod, Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (mod.ownerKey && levelOf(user.role) !== 'boss' && !scopeIds(user).includes(row[mod.ownerKey])) return forbidden(res);
    return row;
  };

  app.patch('/api/erp/:mod/:id', getModule, (req, res) => {
    const row = loadOwned(req, res);
    if (!row || res.headersSent) return;
    const { mod, user } = req;
    const parsed = parse(mod, req.body ?? {}, { partial: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const data = parsed.out;
    if (data.owner_id && !scopeIds(user).includes(data.owner_id)) return forbidden(res);
    const keys = Object.keys(data);
    if (!keys.length) return res.json({ ok: true });
    try {
      db.prepare(`UPDATE ${mod.table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => data[k]), row.id);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'That code is already in use' });
      throw err;
    }
    audit(user.id, `${req.modName}_updated`, `${row.po_no ?? row.code ?? row.id}: ${keys.join(', ')}`);
    res.json({ ok: true });
  });

  app.delete('/api/erp/:mod/:id', getModule, (req, res) => {
    const { mod, user } = req;
    if (levelOf(user.role) === 'employee') return forbidden(res); // only managers and the boss delete records
    const row = loadOwned(req, res);
    if (!row || res.headersSent) return;
    db.prepare(`DELETE FROM ${mod.table} WHERE id = ?`).run(row.id);
    audit(user.id, `${req.modName}_deleted`, String(row.po_no ?? row.code ?? row.id));
    res.json({ ok: true });
  });
}
