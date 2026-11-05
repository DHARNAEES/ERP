import express from 'express';
import cors from 'cors';
import { db } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';
import { ROLES, SUPERVISOR_ROLES, levelOf } from './roles.js';
import { registerErp } from './erp.js';

const app = express();
app.disable('x-powered-by');
// The client is served from the same origin (Vite proxy / Netlify redirect), so CORS is
// only enabled when explicit origins are configured (CORS_ORIGIN="https://a.com,https://b.com").
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) }));
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  next();
});
app.use(express.json({ limit: '50kb' }));

const isoDate = (d) => d.toISOString().slice(0, 10);
// "Today" in the organisation's timezone (default India), not UTC.
const APP_TZ = process.env.APP_TZ ?? 'Asia/Kolkata';
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: APP_TZ });

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
// The counter is keyed by client IP + email, so a stranger cannot lock out someone else's account
// from a different address. The map is capped so it cannot grow without bound.
const attempts = new Map();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const MAX_TRACKED = 5000;
const DUMMY_HASH = hashPassword('not-a-real-password');
const clientIp = (req) =>
  req.header('x-nf-client-connection-ip') ||
  String(req.header('x-forwarded-for') ?? '').split(',')[0].trim() ||
  req.socket?.remoteAddress ||
  'unknown';

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 200);
  const password = String(req.body?.password ?? '').slice(0, 200);
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const key = `${clientIp(req)}|${email}`;
  for (const [k, v] of attempts) if (Date.now() - v.last >= LOCK_MS) attempts.delete(k);
  const rec = attempts.get(key);
  if (rec && rec.fails >= MAX_FAILS && Date.now() - rec.last < LOCK_MS) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Always run one hash check so unknown emails and wrong passwords take similar time.
  const ok = verifyPassword(password, user?.password_hash ?? DUMMY_HASH) && user && user.active;
  if (!ok) {
    if (attempts.size >= MAX_TRACKED && !attempts.has(key)) attempts.delete(attempts.keys().next().value);
    attempts.set(key, { fails: (rec && Date.now() - rec.last < LOCK_MS ? rec.fails : 0) + 1, last: Date.now() });
    audit(user?.id ?? null, 'login_failed', email);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  attempts.delete(key);
  audit(user.id, 'login');
  res.json({ token: signToken(user.id), user: publicUser(user) });
});

// ---------- Everything below needs a valid session ----------
app.use('/api', (req, res, next) => {
  const m = /^Bearer (.+)$/.exec(req.header('authorization') ?? '');
  const tok = m && verifyToken(m[1]);
  // Reload the user on every request so role changes and deactivation apply immediately.
  const user = tok && db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(tok.uid);
  // Tokens issued before the last password change/reset are no longer valid.
  if (!user || tok.iat < user.pw_changed_at) return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  req.user = user;
  // Until the initial/reset password is changed, only the account endpoints work.
  if (user.must_change_password && !['/me', '/auth/change-password'].includes(req.path)) {
    return res.status(403).json({ error: 'You must change your password before continuing' });
  }
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
  // Revoke every earlier session, then hand this client a fresh token.
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, pw_changed_at = ? WHERE id = ?').run(
    hashPassword(next),
    Date.now(),
    req.user.id,
  );
  audit(req.user.id, 'password_changed');
  res.json({ ok: true, token: signToken(req.user.id) });
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
  const month = todayStr().slice(0, 7);
  const balances = db.prepare('SELECT type, days FROM leave_balances WHERE user_id = ?').all(uid);
  const pending = db.prepare("SELECT COUNT(*) AS n FROM leaves WHERE user_id = ? AND status = 'pending'").get(uid).n;
  const approved = db
    .prepare("SELECT COUNT(*) AS n FROM leaves WHERE user_id = ? AND status = 'approved' AND start_date LIKE ?")
    .get(uid, `${month}%`).n;
  // Only month and day leave the server: the birth year is personal data (boss only).
  const monthDay = (col) =>
    db.prepare(`SELECT name, ${col} AS date FROM users WHERE active = 1 AND substr(${col}, 6, 2) = ?`).all(month.slice(5));
  const masked = (rows) => rows.map((u) => ({ name: u.name, date: `0000-${u.date.slice(5)}` }));
  res.json({
    totalBalance: balances.reduce((sum, b) => sum + b.days, 0),
    balances,
    pending,
    approved,
    birthdays: masked(monthDay('birthday')),
    anniversaries: masked(monthDay('join_date').filter((u) => u.date.slice(0, 4) !== month.slice(0, 4))),
  });
});

// Team/organisation summary for managers (their team) and the boss (everyone).
app.get('/api/overview', requireRole('manager', 'boss'), (req, res) => {
  const ids = scopeIds(req.user);
  const ph = placeholders(ids);
  const today = todayStr();
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
  if (!isRealDate(String(start_date)) || !isRealDate(String(end_date))) return res.status(400).json({ error: 'Enter valid dates' });
  if (end_date < start_date) return res.status(400).json({ error: 'The end date cannot be earlier than the start date' });
  if ((Date.parse(end_date) - Date.parse(start_date)) / 86400000 > 366) {
    return res.status(400).json({ error: 'A leave request cannot span more than a year' });
  }

  const days = countWorkingDays(start_date, end_date);
  if (days === 0) return res.status(400).json({ error: 'The selected period contains no working days' });

  const balance = db.prepare('SELECT days FROM leave_balances WHERE user_id = ? AND type = ?').get(req.user.id, type);
  if (!balance) return res.status(400).json({ error: 'Unknown leave type' });
  // Pending requests are reserved against the balance so it cannot be over-booked.
  const reserved = db
    .prepare("SELECT COALESCE(SUM(days), 0) AS n FROM leaves WHERE user_id = ? AND type = ? AND status = 'pending'")
    .get(req.user.id, type).n;
  const available = balance.days - reserved;
  if (available < days) {
    return res.status(400).json({ error: `Insufficient balance: only ${Math.max(available, 0)} day(s) of ${type} available (including pending requests)` });
  }
  const overlap = db
    .prepare("SELECT 1 FROM leaves WHERE user_id = ? AND status IN ('pending', 'approved') AND start_date <= ? AND end_date >= ?")
    .get(req.user.id, end_date, start_date);
  if (overlap) return res.status(400).json({ error: 'You already have a leave request that overlaps these dates' });

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

  db.exec('BEGIN IMMEDIATE');
  try {
    if (status === 'approved') {
      const bal = db.prepare('SELECT days FROM leave_balances WHERE user_id = ? AND type = ?').get(leave.user_id, leave.type);
      if (!bal || bal.days < leave.days) {
        db.exec('ROLLBACK');
        return res.status(400).json({ error: 'The employee does not have enough balance for this leave' });
      }
      db.prepare('UPDATE leave_balances SET days = days - ? WHERE user_id = ? AND type = ?').run(leave.days, leave.user_id, leave.type);
    }
    db.prepare('UPDATE leaves SET status = ? WHERE id = ?').run(status, leave.id);
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
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.month ?? '')) ? req.query.month : todayStr().slice(0, 7);
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
  const today = todayStr();
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
  const d = new Date(`${todayStr()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
};

app.get('/api/work-status', (req, res) => {
  const today = todayStr();
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
  const today = todayStr();
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
  const date = todayStr();
  const existing = db.prepare('SELECT 1 FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, date);
  if (existing) return res.status(400).json({ error: 'Already checked in today' });
  db.prepare('INSERT INTO attendance (user_id, date, check_in) VALUES (?, ?, ?)').run(req.user.id, date, now.toISOString());
  res.status(201).json(db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, date));
});

app.post('/api/attendance/check-out', (req, res) => {
  const now = new Date();
  const date = todayStr();
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
  const today = todayStr();
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
      .run(name.trim(), email.trim().toLowerCase(), role, mgr, hashPassword(password), todayStr());
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
  if (active !== undefined && typeof active !== 'boolean') return res.status(400).json({ error: 'active must be true or false' });

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
  // Walk up the proposed reporting line: it must not lead back to the person being edited.
  for (let up = newMgr, hops = 0; up != null && hops < 100; hops++) {
    if (up === target.id) return res.status(400).json({ error: 'That reporting line would create a loop' });
    up = db.prepare('SELECT manager_id FROM users WHERE id = ?').get(up)?.manager_id ?? null;
  }
  const losesReports = active === false || (newRole !== target.role && !SUPERVISOR_ROLES.includes(newRole));
  if (losesReports && db.prepare('SELECT 1 FROM users WHERE manager_id = ? AND active = 1').get(target.id)) {
    return res.status(400).json({ error: 'Reassign this person’s direct reports first' });
  }

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

// ---------- Stock ----------
// Everyone signed in can view stock. Adding products and adjusting quantities is for managers and the boss.
const stockStatus = (p) => (p.qty <= 0 ? 'out' : p.qty <= p.min_qty ? 'low' : 'in');

app.get('/api/stock', (req, res) => {
  const { q, category, make, status, rack, vendor } = req.query;
  const includeOut = req.query.include_out === '1';
  const where = [];
  const args = [];
  const like = (v) => `%${String(v).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  if (q) {
    where.push("(code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR make LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')");
    args.push(like(q), like(q), like(q), like(q));
  }
  for (const [col, v] of [['category', category], ['make', make], ['rack', rack], ['vendor', vendor]]) {
    if (v) {
      where.push(`${col} = ?`);
      args.push(String(v));
    }
  }
  if (status === 'out') where.push('qty <= 0');
  else if (status === 'low') where.push('qty > 0 AND qty <= min_qty');
  else if (status === 'in') where.push('qty > min_qty');
  else if (!includeOut) where.push('qty > 0');
  const rows = db
    .prepare(`SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name LIMIT 300`)
    .all(...args)
    .map((p) => ({ ...p, value: p.qty * p.unit_price, status: stockStatus(p) }));

  const all = db.prepare('SELECT qty, min_qty, unit_price FROM products').all();
  const distinct = (col) => db.prepare(`SELECT DISTINCT ${col} AS v FROM products WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY v`).all().map((r) => r.v);
  res.json({
    summary: {
      totalProducts: all.length,
      totalAvailable: all.reduce((s, p) => s + p.qty, 0),
      inventoryValue: all.reduce((s, p) => s + p.qty * p.unit_price, 0),
      lowStock: all.filter((p) => p.qty > 0 && p.qty <= p.min_qty).length,
      outOfStock: all.filter((p) => p.qty <= 0).length,
    },
    options: { categories: distinct('category'), makes: distinct('make'), racks: distinct('rack'), vendors: distinct('vendor') },
    hiddenOut: includeOut || status ? 0 : all.filter((p) => p.qty <= 0).length,
    products: rows,
  });
});

app.get('/api/stock/log', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT s.id, s.at, s.change, s.qty_after, s.reason, p.code, p.name, u.name AS actor
         FROM stock_log s JOIN products p ON p.id = s.product_id LEFT JOIN users u ON u.id = s.actor_id
         ORDER BY s.id DESC LIMIT 200`,
      )
      .all(),
  );
});

app.post('/api/stock/products', requireRole('manager', 'boss'), (req, res) => {
  const b = req.body ?? {};
  const text = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));
  const num = (v) => (v === '' || v == null ? 0 : Number(v));
  const code = text(b.code, 60);
  const name = text(b.name, 200);
  const unit_price = num(b.unit_price);
  const qty = num(b.qty);
  const min_qty = num(b.min_qty);
  if (!code || !name) return res.status(400).json({ error: 'Code and name are required' });
  if (![unit_price, qty, min_qty].every((n) => Number.isFinite(n) && n >= 0 && n < 1e9)) {
    return res.status(400).json({ error: 'Price and quantities must be zero or more' });
  }
  try {
    const info = db
      .prepare('INSERT INTO products (code, name, category, make, rack, vendor, unit_price, qty, min_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(code, name, text(b.category, 80) || null, text(b.make, 80) || null, text(b.rack, 40) || null, text(b.vendor, 120) || null, unit_price, qty, min_qty);
    if (qty > 0) {
      db.prepare('INSERT INTO stock_log (product_id, change, qty_after, reason, actor_id) VALUES (?, ?, ?, ?, ?)').run(
        info.lastInsertRowid, qty, qty, 'Opening stock', req.user.id,
      );
    }
    audit(req.user.id, 'product_created', `${code} ${name}`);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'A product with that code already exists' });
    throw err;
  }
});

app.post('/api/stock/products/:id/adjust', requireRole('manager', 'boss'), (req, res) => {
  const change = Number(req.body?.change);
  const reason = String(req.body?.reason ?? '').trim().slice(0, 200);
  if (!Number.isFinite(change) || change === 0 || Math.abs(change) >= 1e9) return res.status(400).json({ error: 'Enter a non-zero quantity change' });
  if (!reason) return res.status(400).json({ error: 'A reason is required' });
  db.exec('BEGIN IMMEDIATE');
  try {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
    if (!p) {
      db.exec('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    if (p.qty + change < 0) {
      db.exec('ROLLBACK');
      return res.status(400).json({ error: `Only ${p.qty} in stock; cannot remove ${Math.abs(change)}` });
    }
    const after = p.qty + change;
    db.prepare('UPDATE products SET qty = ? WHERE id = ?').run(after, p.id);
    db.prepare('INSERT INTO stock_log (product_id, change, qty_after, reason, actor_id) VALUES (?, ?, ?, ?, ?)').run(p.id, change, after, reason, req.user.id);
    db.exec('COMMIT');
    res.json({ ok: true, qty: after });
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
});

// Boss sets a temporary password for someone who is locked out. They must change it at next sign-in,
// and every session they already had is revoked.
app.post('/api/users/:id/reset-password', requireRole('boss'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'Not found' });
  const { password } = req.body ?? {};
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, pw_changed_at = ? WHERE id = ?').run(
    hashPassword(password),
    Date.now(),
    target.id,
  );
  audit(req.user.id, 'password_reset', target.name);
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

registerErp(app, { audit, levelOf, scopeIds, isRealDate, todayStr });

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'An unexpected error occurred' });
});

export default app;
