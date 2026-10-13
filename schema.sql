-- The Learning Minds Higher Secondary School - Database Schema
-- SQLite. NO payment / fee / billing tables exist anywhere in this schema.

-- ===== Core identity & accounts (wired up in Step 3 - login system) =====
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','teacher','student')),
  full_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  qualifications TEXT,
  bio TEXT,
  photo_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,        -- e.g. "9th"
  section TEXT,               -- e.g. "A"
  UNIQUE(name, section)
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  roll_no TEXT UNIQUE,
  full_name TEXT NOT NULL,
  class_id INTEGER REFERENCES classes(id),
  guardian_name TEXT,
  guardian_contact TEXT,
  admission_id INTEGER REFERENCES admissions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);

CREATE TABLE IF NOT EXISTS class_teacher_subject (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,             -- random session token
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ===== Admissions (Step 2) =====
CREATE TABLE IF NOT EXISTS admissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL UNIQUE,     -- e.g. LM-2026-0001
  student_name TEXT NOT NULL,
  dob TEXT NOT NULL,
  gender TEXT NOT NULL,
  previous_school TEXT,
  class_applied_for TEXT NOT NULL,
  guardian_name TEXT NOT NULL,
  guardian_relationship TEXT NOT NULL,
  guardian_contact TEXT NOT NULL,
  guardian_email TEXT,
  home_address TEXT NOT NULL,
  additional_info TEXT,
  photo_path TEXT,
  document_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  decided_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_admissions_status ON admissions(status);
CREATE INDEX IF NOT EXISTS idx_admissions_name ON admissions(student_name);

-- ===== Announcements (Step 2) =====
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',     -- all | teachers | students | class:<class_id>
  posted_by TEXT NOT NULL,
  is_published INTEGER NOT NULL DEFAULT 1,
  announcement_date TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_announcements_audience ON announcements(audience);
CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(is_published);

-- ===== Future (not built yet) =====
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present','absent','leave')),
  UNIQUE(student_id, date)
);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  term TEXT NOT NULL,
  marks REAL,
  out_of REAL
);
