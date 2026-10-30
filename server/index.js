import express from 'express';
import cors from 'cors';
import { db } from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

// Demo auth: the client sends the id of the user it is acting as.
// Replace with real session/JWT auth before exposing this anywhere.
app.use('/api', (req, res, next) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.header('x-user-id') ?? 1));
  if (!user) return res.status(401).json({ error: 'Unknown user' });
  req.user = user;
  next();
});

const isoDate = (d) => d.toISOString().slice(0, 10);

function countWorkingDays(start, end) {
  const holidays = new Set(db.prepare('SELECT date FROM holidays WHERE optional = 0').all().map((h) => h.date));
  let days = 0;
  for (let d = new Date(start); d <= new Date(end); d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(isoDate(d))) days++;
  }
  return days;
}

app.get('/api/me', (req, res) => {
  res.json({ ...req.user, users: db.prepare('SELECT id, name, role FROM users').all() });
});

app.get('/api/dashboard', (req, res) => {
  const uid = req.user.id;
  const month = isoDate(new Date()).slice(0, 7);
  const balances = db.prepare('SELECT type, days FROM leave_balances WHERE user_id = ?').all(uid);
  const pending = db.prepare("SELECT COUNT(*) AS n FROM leaves WHERE user_id = ? AND status = 'pending'").get(uid).n;
  const approved = db
    .prepare("SELECT COUNT(*) AS n FROM leaves WHERE user_id = ? AND status = 'approved' AND start_date LIKE ?")
    .get(uid, `${month}%`).n;
  const monthDay = (col) =>
    db.prepare(`SELECT name, ${col} AS date FROM users WHERE substr(${col}, 6, 2) = ?`).all(month.slice(5));
  res.json({
    totalBalance: balances.reduce((sum, b) => sum + b.days, 0),
    balances,
    pending,
    approved,
    birthdays: monthDay('birthday'),
    anniversaries: monthDay('join_date').filter((u) => u.date.slice(0, 4) !== month.slice(0, 4)),
  });
});

app.get('/api/holidays', (_req, res) => {
  res.json(db.prepare('SELECT date, name, optional FROM holidays ORDER BY date').all());
});

app.get('/api/leaves', (req, res) => {
  const all = req.user.role === 'manager' && req.query.scope === 'all';
  const rows = db
    .prepare(
      `SELECT l.*, u.name AS employee FROM leaves l JOIN users u ON u.id = l.user_id
       ${all ? '' : 'WHERE l.user_id = ?'} ORDER BY l.start_date DESC`,
    )
    .all(...(all ? [] : [req.user.id]));
  res.json(rows);
});

app.post('/api/leaves', (req, res) => {
  const { type, start_date, end_date, reason } = req.body ?? {};
  if (!type || !start_date || !end_date) return res.status(400).json({ error: 'type, start_date and end_date are required' });
  if (end_date < start_date) return res.status(400).json({ error: 'End date is before start date' });

  const days = countWorkingDays(start_date, end_date);
  if (days === 0) return res.status(400).json({ error: 'Selected range has no working days' });

  const balance = db.prepare('SELECT days FROM leave_balances WHERE user_id = ? AND type = ?').get(req.user.id, type);
  if (!balance) return res.status(400).json({ error: 'Unknown leave type' });
  if (balance.days < days) return res.status(400).json({ error: `Only ${balance.days} day(s) of ${type} left` });

  const info = db
    .prepare('INSERT INTO leaves (user_id, type, start_date, end_date, days, reason) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, type, start_date, end_date, days, reason ?? null);
  res.status(201).json(db.prepare('SELECT * FROM leaves WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/leaves/:id', (req, res) => {
  const { status } = req.body ?? {};
  const leave = db.prepare('SELECT * FROM leaves WHERE id = ?').get(Number(req.params.id));
  if (!leave) return res.status(404).json({ error: 'Not found' });

  const isOwner = leave.user_id === req.user.id;
  const isManager = req.user.role === 'manager';
  const allowed =
    (status === 'cancelled' && isOwner && leave.status === 'pending') ||
    (['approved', 'rejected'].includes(status) && isManager && leave.status === 'pending');
  if (!allowed) return res.status(403).json({ error: 'Not allowed' });

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
  res.json(db.prepare('SELECT * FROM leaves WHERE id = ?').get(leave.id));
});

app.get('/api/employees', (_req, res) => {
  res.json(db.prepare('SELECT id, name, email, role, join_date FROM users ORDER BY name').all());
});

// Today's entry first, then history. Managers can pass scope=all for the whole team.
app.get('/api/attendance', (req, res) => {
  const all = req.user.role === 'manager' && req.query.scope === 'all';
  const rows = db
    .prepare(
      `SELECT a.*, u.name AS employee FROM attendance a JOIN users u ON u.id = a.user_id
       ${all ? '' : 'WHERE a.user_id = ?'} ORDER BY a.date DESC, u.name LIMIT 60`,
    )
    .all(...(all ? [] : [req.user.id]));
  res.json(rows);
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

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});

const port = process.env.PORT ?? 4000;
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
