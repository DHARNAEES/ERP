import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.js';

// PEOPLEHUB_DB lets hosts without a persistent disk (e.g. Netlify Functions) point at /tmp.
export const db = new DatabaseSync(
  process.env.PEOPLEHUB_DB ?? new URL('./peoplehub.db', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
);

// The login/roles update changed the users table. Databases from before it only hold
// the demo seed data, so reset them (re-seeded below) instead of migrating.
const userCols = db.prepare('PRAGMA table_info(users)').all();
if (userCols.length && !userCols.some((c) => c.name === 'password_hash')) {
  db.exec('DROP TABLE IF EXISTS attendance; DROP TABLE IF EXISTS leaves; DROP TABLE IF EXISTS leave_balances; DROP TABLE users;');
}

const USERS_COLUMNS = `
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('technical', 'non_technical', 'sales', 'team_lead', 'manager', 'boss')),
    manager_id INTEGER REFERENCES users(id),
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    birthday TEXT,
    join_date TEXT`;

// Roles changed from employee/manager/boss to technical/non_technical/sales/team_lead/manager/boss.
// Rebuild the users table (SQLite cannot alter a CHECK) and keep every account, mapping the old
// "employee" role to "technical".
const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql;
if (usersSql && !usersSql.includes("'technical'")) {
  db.exec('PRAGMA foreign_keys = OFF; BEGIN;');
  try {
    db.exec(`CREATE TABLE users_new (${USERS_COLUMNS});
      INSERT INTO users_new SELECT id, name, email,
        CASE role WHEN 'employee' THEN 'technical' ELSE role END,
        manager_id, password_hash, must_change_password, active, birthday, join_date FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (${USERS_COLUMNS});
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    detail TEXT
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

// Personal details the boss records for each person. Added with ALTER so existing databases
// keep their accounts.
const have = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
for (const col of ['phone', 'gender', 'address', 'emergency_name', 'emergency_phone']) {
  if (!have.has(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
}

if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  // Demo accounts all start with SEED_PASSWORD and must change it at first login.
  const seedHash = hashPassword(process.env.SEED_PASSWORD ?? 'PeopleHub@123');
  const addUser = db.prepare(
    'INSERT INTO users (id, name, email, role, manager_id, password_hash, birthday, join_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  addUser.run(4, 'Arjun Mehta', 'boss@example.com', 'boss', null, seedHash, '1980-02-12', '2015-01-05');
  addUser.run(2, 'Vikram Shah', 'vikram@example.com', 'manager', 4, seedHash, '1988-04-21', '2019-06-01');
  addUser.run(1, 'Asha Rao', 'asha@example.com', 'technical', 2, seedHash, '1994-11-03', '2022-11-14');
  addUser.run(3, 'Meera Nair', 'meera@example.com', 'sales', 2, seedHash, '1996-10-30', '2023-10-29');

  const addBalance = db.prepare('INSERT INTO leave_balances (user_id, type, days) VALUES (?, ?, ?)');
  for (const uid of [1, 2, 3, 4]) {
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
