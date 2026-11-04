import express from 'express';
import cors from 'cors';
import { db } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';
import { ROLES, SUPERVISOR_ROLES, levelOf } from './roles.js';

const app = express();
app.use(cors());
app.use(express.json());

const isoDate = (d) => d.toISOString().slice(0, 10);

// ---------- Audit log ----------
const audit = (actorId, action, detail = null) =>
  db.prepare('INSERT INTO audit_log (actor_id, action, detail) VALUES (?, ?, ?)').run(actorId, action, detail);

// ---------- Access rules ----------
// Each job role maps to an access level (see roles.js):
// employee: only their own records            (technical, non-technical, sales)
// manager : themselves + their direct reports (team lead, manager)
// boss    : everyone, and the only level that manages accounts and reads the audit log
function scopeIds(user) {
  const level = levelOf(user.role);
  if (level === 'boss') return db.prepare('SELECT id FROM users').all().map((r) => r.id);
  if (level === 'manager') {
    return [user.id, ...db.prepare('SELECT id FROM users WHERE manager_id = ?').all(user.id).map((r) => r.id)];
  }
  return [user.id];
}
const placeholders = (ids) => ids.map(() => '?').join(',');

// Who may approve/reject a leave request: the boss for anyone, a manager for their direct reports.
function canDecide(approver, leaveOwnerId) {
  const level = levelOf(approver.role);
  if (level === 'boss') return true;
  if (level !== 'manager' || leaveOwnerId === approver.id) return false;
  return db.prepare('SELECT 1 FROM users WHERE id = ? AND manager_id = ?').get(leaveOwnerId, approver.id) != null;
}

// Guards a route by access level ('manager' or 'boss'), not by job title.
const requireRole = (...levels) => (req, res, next) =>
  levels.includes(levelOf(req.user.role)) ? next() : res.status(403).json({ error: 'You do not have permission to perform this action' });

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  level: levelOf(u.role),
  manager_id: u.manager_id,
  must_change_password: !!u.must_change_password,
});

// ---------- Login (public) ----------
// Failed attempts are counted per email: 5 failures lock that email for 15 minutes.
const attempts = new Map();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const DUMMY_HASH = hashPassword('not-a-real-password');

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const rec = attempts.get(email);
  if (rec && rec.fails >= MAX_FAILS && Date.now() - rec.last < LOCK_MS) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Always run one hash check so unknown emails and wrong passwords take similar time.
  const ok = verifyPassword(password, user?.password_hash ?? DUMMY_HASH) && user && user.active;
  if (!ok) {
    attempts.set(email, { fails: (rec && Date.now() - rec.last < LOCK_MS ? rec.fails : 0) + 1, last: Date.now() });
    audit(user?.id ?? null, 'login_failed', email);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  attempts.delete(email);
  audit(user.id, 'login');
  res.json({ token: signToken(user.id), user: publicUser(user) });
});

// ---------- Everything below needs a valid session ----------
app.use('/api', (req, res, next) => {
  const m = /^Bearer (.+)$/.exec(req.header('authorization') ?? '');
  const uid = m && verifyToken(m[1]);
  // Reload the user on every request so role changes and deactivation apply immediately.
  const user = uid && db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(uid);
  if (!user) return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  req.user = user;
  next();
});

app.get('/api/me', (req, res) => res.json(publicUser(req.user)));

app.post('/api/auth/change-password', (req, res) => {
  const { current, next } = req.body ?? {};
  if (!verifyPassword(String(current ?? ''), req.user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (typeof next !== 'string' || next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  if (next === current) return res.status(400).json({ error: 'New password must be different' });
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(next), req.user.id);
  audit(req.user.id, 'password_changed');
  res.json({ ok: true });
});

function countWorkingDays(start, end) {
  const holidays = new Set(db.prepare('SELECT date FROM holidays WHERE optional = 0').all().map((h) => h.date));
  let days = 0;
  for (let d = new Date(start); d <= new Date(end); d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(isoDate(d))) days++;
  }
  return days;
}

app.get('/api/dashboard', (req, res) => {
  const uid = req.user.id;
  const month = isoDate(new Date()).slice(0, 7);
  const balances = db.prepare('SELECT type, days FROM leave_balances WHERE user_id = ?').all(uid);
  const pending = db.prepare("SELECT COUNT(*) AS n FROM leaves WHERE user_id = ? AND status = 'pending'").get(uid).n;
  const approved = db
    .prepare("SELECT COUNT(*) AS n FROM leaves WHERE user_id = ? AND status = 'approved' AND start_date LIKE ?")
    .get(uid, `${month}%`).n;
  const monthDay = (col) =>
    db.prepare(`SELECT name, ${col} AS date FROM users WHERE active = 1 AND substr(${col}, 6, 2) = ?`).all(month.slice(5));
  res.json({
    totalBalance: balances.reduce((sum, b) => sum + b.days, 0),
    balances,
    pending,
    approved,
    birthdays: monthDay('birthday'),
    anniversaries: monthDay('join_date').filter((u) => u.date.slice(0, 4) !== month.slice(0, 4)),
  });
});

// Team/organisation summary for managers (their team) and the boss (everyone).
app.get('/api/overview', requireRole('manager', 'boss'), (req, res) => {
  const ids = scopeIds(req.user);
  const ph = placeholders(ids);
  const today = isoDate(new Date());
  const approvable = ids.filter((id) => canDecide(req.user, id));
  res.json({
    scope: levelOf(req.user.role) === 'boss' ? 'Organisation' : 'My team',
    headcount: db.prepare(`SELECT COUNT(*) AS n FROM users WHERE active = 1 AND id IN (${ph})`).get(...ids).n,
    checkedInToday: db.prepare(`SELECT COUNT(*) AS n FROM attendance WHERE date = ? AND user_id IN (${ph})`).get(today, ...ids).n,
    onLeaveToday: db
      .prepare(`SELECT COUNT(*) AS n FROM leaves WHERE status = 'approved' AND start_date <= ? AND end_date >= ? AND user_id IN (${ph})`)
      .get(today, today, ...ids).n,
    pendingApprovals: approvable.length
      ? db.prepare(`SELECT COUNT(*) AS n FROM leaves WHERE status = 'pending' AND user_id IN (${placeholders(approvable)})`).get(...approvable).n
      : 0,
  });
});

app.get('/api/holidays', (_req, res) => {
  res.json(db.prepare('SELECT date, name, optional FROM holidays ORDER BY date').all());
});

app.get('/api/leaves', (req, res) => {
  const ids = req.query.scope === 'all' && levelOf(req.user.role) !== 'employee' ? scopeIds(req.user) : [req.user.id];
  const rows = db
    .prepare(
      `SELECT l.*, u.name AS employee FROM leaves l JOIN users u ON u.id = l.user_id
       WHERE l.user_id IN (${placeholders(ids)}) ORDER BY l.start_date DESC`,
    )
    .all(...ids)
    .map((l) => ({ ...l, can_decide: l.status === 'pending' && canDecide(req.user, l.user_id) }));
  res.json(rows);
});

app.post('/api/leaves', (req, res) => {
  const { type, start_date, end_date, reason } = req.body ?? {};
  if (!type || !start_date || !end_date) return res.status(400).json({ error: 'type, start_date and end_date are required' });
  if (end_date < start_date) return res.status(400).json({ error: 'The end date cannot be earlier than the start date' });

  const days = countWorkingDays(start_date, end_date);
  if (days === 0) return res.status(400).json({ error: 'The selected period contains no working days' });

  const balance = db.prepare('SELECT days FROM leave_balances WHERE user_id = ? AND type = ?').get(req.user.id, type);
  if (!balance) return res.status(400).json({ error: 'Unknown leave type' });
  if (balance.days < days) return res.status(400).json({ error: `Insufficient balance: only ${balance.days} day(s) of ${type} remaining` });

  const info = db
    .prepare('INSERT INTO leaves (user_id, type, start_date, end_date, days, reason) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, type, start_date, end_date, days, reason ?? null);
  audit(req.user.id, 'leave_requested', `${type} ${start_date} → ${end_date} (${days}d)`);
  res.status(201).json(db.prepare('SELECT * FROM leaves WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/leaves/:id', (req, res) => {
  const { status } = req.body ?? {};
  const leave = db.prepare('SELECT * FROM leaves WHERE id = ?').get(Number(req.params.id));
  if (!leave) return res.status(404).json({ error: 'Not found' });

  const allowed =
    (status === 'cancelled' && leave.user_id === req.user.id && leave.status === 'pending') ||
    (['approved', 'rejected'].includes(status) && leave.status === 'pending' && canDecide(req.user, leave.user_id));
  if (!allowed) return res.status(403).json({ error: 'You do not have permission to perform this action' });

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE leaves SET status = ? WHERE id = ?').run(status, leave.id);
    if (status === 'approved') {
      db.prepare('UPDATE leave_balances SET days = days - ? WHERE user_id = ? AND type = ?').run(leave.days, leave.user_id, leave.type);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const owner = db.prepare('SELECT name FROM users WHERE id = ?').get(leave.user_id).name;
  audit(req.user.id, `leave_${status}`, `${owner}: ${leave.type} ${leave.start_date} → ${leave.end_date}`);
  res.json(db.prepare('SELECT * FROM leaves WHERE id = ?').get(leave.id));
});

// Directory of the people the caller is allowed to see. Employees have no directory.
app.get('/api/employees', requireRole('manager', 'boss'), (req, res) => {
  const ids = scopeIds(req.user);
  // Personal details (birthday, phone, address, emergency contact) are for the boss only.
  const personalCols = levelOf(req.user.role) === 'boss' ? ', u.birthday, u.gender, u.phone, u.address, u.emergency_name, u.emergency_phone' : '';
  res.json(
    db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.join_date, u.manager_id, u.active, m.name AS manager${personalCols}
         FROM users u LEFT JOIN users m ON m.id = u.manager_id
         WHERE u.id IN (${placeholders(ids)}) ORDER BY u.name`,
      )
      .all(...ids),
  );
});

// Today's entry first, then history. Managers see their team, the boss sees everyone (scope=all).
app.get('/api/attendance', (req, res) => {
  const ids = req.query.scope === 'all' && levelOf(req.user.role) !== 'employee' ? scopeIds(req.user) : [req.user.id];
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.month ?? '')) ? req.query.month : isoDate(new Date()).slice(0, 7);
  const rows = db
    .prepare(
      `SELECT a.*, u.name AS employee FROM attendance a JOIN users u ON u.id = a.user_id
       WHERE a.user_id IN (${placeholders(ids)}) AND a.date LIKE ? ORDER BY a.date DESC, u.name LIMIT 2000`,
    )
    .all(...ids, `${month}%`);
  res.json(rows);
});

// Who is in, out or on leave today: managers see their team, the boss sees everyone.
app.get('/api/attendance/board', requireRole('manager', 'boss'), (req, res) => {
  const ids = scopeIds(req.user);
  const today = isoDate(new Date());
  res.json(
    db
      .prepare(
        `SELECT u.id, u.name, u.role, a.check_in, a.check_out,
           EXISTS (SELECT 1 FROM leaves l WHERE l.user_id = u.id AND l.status = 'approved' AND l.start_date <= ? AND l.end_date >= ?) AS on_leave
         FROM users u LEFT JOIN attendance a ON a.user_id = u.id AND a.date = ?
         WHERE u.active = 1 AND u.id IN (${placeholders(ids)}) ORDER BY u.name`,
      )
      .all(today, today, today, ...ids),
  );
});

// ---------- Daily work status ----------
// Everyone posts their own update (one per day, editable for 7 days). Managers read their team's
// updates, the boss reads everyone's.
const WS_STATUSES = ['on_track', 'at_risk', 'blocked'];
const daysAgo = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
};

app.get('/api/work-status', (req, res) => {
  const today = isoDate(new Date());
  if (req.query.scope !== 'team') {
    const entries = db.prepare('SELECT * FROM work_status WHERE user_id = ? ORDER BY date DESC LIMIT 30').all(req.user.id);
    return res.json({ today, entries });
  }
  if (levelOf(req.user.role) === 'employee') return res.status(403).json({ error: 'You do not have permission to perform this action' });
  const date = isRealDate(String(req.query.date ?? '')) ? req.query.date : today;
  const ids = scopeIds(req.user);
  const ph = placeholders(ids);
  const entries = db
    .prepare(
      `SELECT w.*, u.name AS employee, u.role FROM work_status w JOIN users u ON u.id = w.user_id
       WHERE w.date = ? AND w.user_id IN (${ph}) ORDER BY u.name`,
    )
    .all(date, ...ids);
  // Anyone active who has not posted and is not on approved leave that day.
  const missing = db
    .prepare(
      `SELECT u.id, u.name FROM users u
       WHERE u.active = 1 AND u.id IN (${ph})
         AND NOT EXISTS (SELECT 1 FROM work_status w WHERE w.user_id = u.id AND w.date = ?)
         AND NOT EXISTS (SELECT 1 FROM leaves l WHERE l.user_id = u.id AND l.status = 'approved' AND l.start_date <= ? AND l.end_date >= ?)
       ORDER BY u.name`,
    )
    .all(...ids, date, date, date);
  res.json({ today, date, entries, missing });
});

app.put('/api/work-status/:date', (req, res) => {
  const { date } = req.params;
  const today = isoDate(new Date());
  if (!isRealDate(date) || date > today || date < daysAgo(7)) {
    return res.status(400).json({ error: 'Updates can be submitted for today and the previous 7 days only' });
  }
  const { status = 'on_track', summary, plan, blockers, hours } = req.body ?? {};
  const text = (v) => (v == null ? '' : String(v).trim());
  if (!WS_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (!text(summary)) return res.status(400).json({ error: 'Please describe the work completed' });
  if (text(summary).length > 2000) return res.status(400).json({ error: 'Work summary is too long (max 2000 characters)' });
  if (text(plan).length > 1000 || text(blockers).length > 1000) return res.status(400).json({ error: 'Plan and blockers are limited to 1000 characters' });
  const h = hours === '' || hours == null ? null : Number(hours);
  if (h !== null && (!Number.isFinite(h) || h < 0 || h > 24)) return res.status(400).json({ error: 'Hours must be between 0 and 24' });

  db.prepare(
    `INSERT INTO work_status (user_id, date, status, summary, plan, blockers, hours) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, date) DO UPDATE SET status = excluded.status, summary = excluded.summary, plan = excluded.plan,
       blockers = excluded.blockers, hours = excluded.hours, updated_at = CURRENT_TIMESTAMP`,
  ).run(req.user.id, date, status, text(summary), text(plan) || null, text(blockers) || null, h);
  res.json(db.prepare('SELECT * FROM work_status WHERE user_id = ? AND date = ?').get(req.user.id, date));
});

app.post('/api/attendance/check-in', (req, res) => {
  const now = new Date();
  const date = isoDate(now);
  const existing = db.prepare('SELECT 1 FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, date);
  if (existing) return res.status(400).json({ error: 'Already checked in today' });
  db.prepare('INSERT INTO attendance (user_id, date, check_in) VALUES (?, ?, ?)').run(req.user.id, date, now.toISOString());
  res.status(201).json(db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, date));
});

app.post('/api/attendance/check-out', (req, res) => {
  const now = new Date();
  const date = isoDate(now);
  const row = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, date);
  if (!row) return res.status(400).json({ error: 'You have not checked in today' });
  if (row.check_out) return res.status(400).json({ error: 'Already checked out today' });
  db.prepare('UPDATE attendance SET check_out = ? WHERE user_id = ? AND date = ?').run(now.toISOString(), req.user.id, date);
  res.json(db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, date));
});

// ---------- Boss only: accounts and audit log ----------
const validReportsTo = (managerId, role) => {
  if (role === 'boss') return managerId == null;
  if (!Number.isInteger(managerId)) return false;
  const m = db.prepare('SELECT role FROM users WHERE id = ? AND active = 1').get(managerId);
  return !!m && SUPERVISOR_ROLES.includes(m.role);
};

// Personal details: validated and trimmed; empty values are stored as NULL.
const PERSONAL = ['birthday', 'join_date', 'phone', 'gender', 'address', 'emergency_name', 'emergency_phone'];
const isRealDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && isoDate(new Date(s)) === s;

function parsePersonal(body) {
  const out = {};
  const today = isoDate(new Date());
  for (const key of PERSONAL) {
    if (body[key] === undefined) continue;
    const v = String(body[key] ?? '').trim();
    if (v === '') {
      if (key === 'join_date') return { error: 'Joined date cannot be empty' };
      out[key] = null;
      continue;
    }
    if (key === 'birthday' && (!isRealDate(v) || v >= today || v < '1930-01-01')) return { error: 'Enter a valid birth date in the past' };
    if (key === 'join_date' && (!isRealDate(v) || v < '1950-01-01' || v > `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`)) {
      return { error: 'Enter a valid joined date' };
    }
    if ((key === 'phone' || key === 'emergency_phone') && !/^\+?[\d\s()-]{7,20}$/.test(v)) return { error: 'Enter a valid phone number' };
    if (key === 'gender' && !['female', 'male', 'other'].includes(v)) return { error: 'Invalid gender' };
    if (key === 'address' && v.length > 300) return { error: 'Address is too long (max 300 characters)' };
    if (key === 'emergency_name' && v.length > 100) return { error: 'Emergency contact name is too long' };
    out[key] = v;
  }
  return { out };
}

// Keys come from the PERSONAL whitelist above, never from user input.
function applyPersonal(id, out) {
  const keys = Object.keys(out);
  if (keys.length) db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => out[k]), id);
}

app.post('/api/users', requireRole('boss'), (req, res) => {
  const { name, email, role, manager_id, password } = req.body ?? {};
  const personal = parsePersonal(req.body ?? {});
  if (personal.error) return res.status(400).json({ error: personal.error });
  if (!name?.trim() || !email?.trim()) return res.status(400).json({ error: 'Name and email are required' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const mgr = role === 'boss' ? null : Number(manager_id);
  if (!validReportsTo(mgr, role)) return res.status(400).json({ error: 'Select an active manager, team lead or boss as the reporting line' });

  try {
    const info = db
      .prepare('INSERT INTO users (name, email, role, manager_id, password_hash, join_date) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name.trim(), email.trim().toLowerCase(), role, mgr, hashPassword(password), isoDate(new Date()));
    applyPersonal(info.lastInsertRowid, personal.out); // overrides the default joined date when given
    const addBalance = db.prepare('INSERT INTO leave_balances (user_id, type, days) VALUES (?, ?, ?)');
    for (const [type, days] of [['Sick Leave', 5], ['Casual Leave', 8], ['Leave with Pay', 0], ['Comp Off', 0]]) {
      addBalance.run(info.lastInsertRowid, type, days);
    }
    audit(req.user.id, 'user_created', `${name.trim()} (${role})`);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'That email is already in use' });
    throw err;
  }
});

app.patch('/api/users/:id', requireRole('boss'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'Not found' });
  const { role, manager_id, active } = req.body ?? {};
  const personal = parsePersonal(req.body ?? {});
  if (personal.error) return res.status(400).json({ error: personal.error });
  const isSelf = target.id === req.user.id;

  // Keeps at least one working boss: you cannot demote or deactivate yourself.
  if (isSelf && ((role && role !== 'boss') || active === false)) {
    return res.status(400).json({ error: 'You cannot demote or deactivate your own account' });
  }
  const newRole = role ?? target.role;
  if (!ROLES.includes(newRole)) return res.status(400).json({ error: 'Invalid role' });
  const newMgr = newRole === 'boss' ? null : manager_id !== undefined ? Number(manager_id) : target.manager_id;
  if ((role !== undefined || manager_id !== undefined) && !validReportsTo(newMgr, newRole)) {
    return res.status(400).json({ error: 'Select an active manager, team lead or boss as the reporting line' });
  }
  if (newMgr === target.id) return res.status(400).json({ error: 'Nobody can report to themselves' });

  db.prepare('UPDATE users SET role = ?, manager_id = ?, active = ? WHERE id = ?').run(
    newRole,
    newMgr,
    active === undefined ? target.active : active ? 1 : 0,
    target.id,
  );
  applyPersonal(target.id, personal.out);
  const changes = [];
  if (Object.keys(personal.out).length) changes.push('personal details updated');
  if (newRole !== target.role) changes.push(`role ${target.role} → ${newRole}`);
  if (newMgr !== target.manager_id) changes.push('reporting line changed');
  if (active !== undefined && (active ? 1 : 0) !== target.active) changes.push(active ? 'activated' : 'deactivated');
  if (changes.length) audit(req.user.id, 'user_updated', `${target.name}: ${changes.join(', ')}`);
  res.json({ ok: true });
});

app.get('/api/audit', requireRole('boss'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  res.json(
    db
      .prepare(
        `SELECT a.id, a.at, a.action, a.detail, u.name AS actor FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT ?`,
      )
      .all(limit),
  );
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'An unexpected error occurred' });
});

export default app;
