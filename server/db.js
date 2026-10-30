import { DatabaseSync } from 'node:sqlite';

export const db = new DatabaseSync(new URL('./peoplehub.db', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));

db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('employee', 'manager')),
    birthday TEXT,
    join_date TEXT
  );
  CREATE TABLE IF NOT EXISTS leave_balances (
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    days REAL NOT NULL,
    PRIMARY KEY (user_id, type)
  );
  CREATE TABLE IF NOT EXISTS leaves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    days REAL NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS holidays (
    date TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    optional INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS attendance (
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    check_in TEXT NOT NULL,
    check_out TEXT,
    PRIMARY KEY (user_id, date)
  );
`);

if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  const addUser = db.prepare('INSERT INTO users (id, name, email, role, birthday, join_date) VALUES (?, ?, ?, ?, ?, ?)');
  addUser.run(1, 'Asha Rao', 'asha@example.com', 'employee', '1994-11-03', '2022-11-14');
  addUser.run(2, 'Vikram Shah', 'vikram@example.com', 'manager', '1988-04-21', '2019-06-01');
  addUser.run(3, 'Meera Nair', 'meera@example.com', 'employee', '1996-10-30', '2023-10-29');

  const addBalance = db.prepare('INSERT INTO leave_balances (user_id, type, days) VALUES (?, ?, ?)');
  for (const uid of [1, 2, 3]) {
    addBalance.run(uid, 'Sick Leave', 5);
    addBalance.run(uid, 'Casual Leave', 8);
    addBalance.run(uid, 'Leave with Pay', 0);
    addBalance.run(uid, 'Comp Off', 2);
  }

  const addHoliday = db.prepare('INSERT INTO holidays (date, name, optional) VALUES (?, ?, ?)');
  const holidays = [
    ['2026-01-26', 'Republic Day', 0],
    ['2026-08-15', 'Independence Day', 0],
    ['2026-10-02', 'Gandhi Jayanthi', 0],
    ['2026-10-19', 'Mahanavami', 0],
    ['2026-10-20', 'Vijayadashami', 0],
    ['2026-11-08', 'Deepavali', 0],
    ['2026-11-09', 'Govardhan Puja', 1],
    ['2026-12-25', 'Christmas', 0],
  ];
  for (const h of holidays) addHoliday.run(...h);

  const addLeave = db.prepare(
    'INSERT INTO leaves (user_id, type, start_date, end_date, days, reason, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  addLeave.run(1, 'Casual Leave', '2026-10-09', '2026-10-09', 1, 'Family function', 'approved');
  addLeave.run(1, 'Casual Leave', '2026-10-16', '2026-10-16', 1, 'Personal work', 'approved');
  addLeave.run(3, 'Sick Leave', '2026-11-02', '2026-11-03', 2, 'Fever', 'pending');
}
