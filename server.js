const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me-before-deploying',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================
// AUTH MIDDLEWARE
// =========================================================
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this.' });
    }
    next();
  };
}

// =========================================================
// AUTH ROUTES
// =========================================================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.is_active || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password, or account is inactive.' });
  }

  req.session.user = {
    id: user.id, username: user.username, role: user.role,
    full_name: user.full_name, must_change_password: !!user.must_change_password
  };
  res.json({ role: user.role, mustChangePassword: !!user.must_change_password });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.session.user);
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(hash, req.session.user.id);
  req.session.user.must_change_password = false;
  res.json({ ok: true });
});

// =========================================================
// ADMIN: ACCOUNT MANAGEMENT
// =========================================================
function findOrCreateClass(label) {
  if (!label || !label.trim()) return null;
  const name = label.trim();
  const existing = db.prepare('SELECT id FROM classes WHERE name = ?').get(name);
  if (existing) return existing.id;
  const result = db.prepare('INSERT INTO classes (name) VALUES (?)').run(name);
  return result.lastInsertRowid;
}

app.post('/api/admin/accounts', requireRole('admin'), (req, res) => {
  const { full_name, username, temp_password, role, subject, class_name, roll_no, guardian_name, guardian_contact, is_active } = req.body || {};
  if (!full_name || !username || !temp_password || !role) {
    return res.status(400).json({ error: 'Full name, username, temporary password, and role are required.' });
  }
  if (!['admin', 'teacher', 'student'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin, teacher, or student.' });
  }
  if (temp_password.length < 6) {
    return res.status(400).json({ error: 'Temporary password must be at least 6 characters.' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'That username is already taken.' });

  const hash = bcrypt.hashSync(temp_password, 10);
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, role, full_name, is_active, must_change_password)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  const tx = db.transaction(() => {
    const result = insertUser.run(username, hash, role, full_name, is_active === false ? 0 : 1);
    const userId = result.lastInsertRowid;
    if (role === 'teacher') {
      db.prepare('INSERT INTO teachers (user_id, full_name, subject) VALUES (?, ?, ?)')
        .run(userId, full_name, subject || 'Information coming soon');
    } else if (role === 'student') {
      const classId = findOrCreateClass(class_name);
      db.prepare(`
        INSERT INTO students (user_id, full_name, class_id, roll_no, guardian_name, guardian_contact)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, full_name, classId, roll_no || null, guardian_name || null, guardian_contact || null);
    }
    return userId;
  });

  try {
    const userId = tx();
    res.status(201).json({ id: userId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create the account.' });
  }
});

app.get('/api/admin/accounts', requireRole('admin'), (req, res) => {
  const { role, q } = req.query;
  let sql = `
    SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.must_change_password, u.created_at,
           t.subject AS teacher_subject,
           c.name AS student_class
    FROM users u
    LEFT JOIN teachers t ON t.user_id = u.id
    LEFT JOIN students s ON s.user_id = u.id
    LEFT JOIN classes c ON c.id = s.class_id
    WHERE 1=1
  `;
  const params = [];
  if (role && ['admin', 'teacher', 'student'].includes(role)) {
    sql += ' AND u.role = ?';
    params.push(role);
  }
  if (q) {
    sql += ' AND (u.full_name LIKE ? OR u.username LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY u.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.put('/api/admin/accounts/:id', requireRole('admin'), (req, res) => {
  const { full_name, username, subject, class_name, roll_no, guardian_name, guardian_contact } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });

  if (username && username !== user.username) {
    const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, user.id);
    if (clash) return res.status(409).json({ error: 'That username is already taken.' });
  }

  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET full_name = COALESCE(?, full_name), username = COALESCE(?, username), updated_at = datetime('now') WHERE id = ?`)
      .run(full_name || null, username || null, user.id);
    if (user.role === 'teacher' && subject !== undefined) {
      db.prepare('UPDATE teachers SET subject = ?, full_name = COALESCE(?, full_name) WHERE user_id = ?')
        .run(subject, full_name || null, user.id);
    }
    if (user.role === 'student') {
      const classId = class_name !== undefined ? findOrCreateClass(class_name) : null;
      db.prepare(`
        UPDATE students SET
          class_id = COALESCE(?, class_id),
          full_name = COALESCE(?, full_name),
          roll_no = COALESCE(?, roll_no),
          guardian_name = COALESCE(?, guardian_name),
          guardian_contact = COALESCE(?, guardian_contact)
        WHERE user_id = ?
      `).run(classId, full_name || null, roll_no || null, guardian_name || null, guardian_contact || null, user.id);
    }
  });

  try {
    tx();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update the account.' });
  }
});

app.patch('/api/admin/accounts/:id/status', requireRole('admin'), (req, res) => {
  const { is_active } = req.body;
  const result = db.prepare(`UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(is_active ? 1 : 0, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Account not found.' });
  res.json({ ok: true });
});

app.patch('/api/admin/accounts/:id/reset-password', requireRole('admin'), (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  const result = db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = datetime('now') WHERE id = ?`)
    .run(hash, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Account not found.' });
  res.json({ ok: true });
});

app.get('/api/admin/classes', requireRole('admin'), (req, res) => {
  res.json(db.prepare('SELECT id, name FROM classes ORDER BY name').all());
});

app.get('/api/admin/teachers', requireRole('admin'), (req, res) => {
  res.json(db.prepare(`
    SELECT t.id, t.full_name, t.subject FROM teachers t
    JOIN users u ON u.id = t.user_id WHERE u.is_active = 1 ORDER BY t.full_name
  `).all());
});

app.get('/api/admin/class-assignments', requireRole('admin'), (req, res) => {
  res.json(db.prepare(`
    SELECT cts.id, t.full_name AS teacher_name, c.name AS class_name, cts.subject
    FROM class_teacher_subject cts
    JOIN teachers t ON t.id = cts.teacher_id
    JOIN classes c ON c.id = cts.class_id
    ORDER BY c.name, cts.subject
  `).all());
});

app.post('/api/admin/class-assignments', requireRole('admin'), (req, res) => {
  const { teacher_id, class_name, subject } = req.body || {};
  if (!teacher_id || !class_name || !subject) {
    return res.status(400).json({ error: 'teacher_id, class_name, and subject are required.' });
  }
  const classId = findOrCreateClass(class_name);
  try {
    const result = db.prepare(`
      INSERT INTO class_teacher_subject (class_id, teacher_id, subject) VALUES (?, ?, ?)
    `).run(classId, teacher_id, subject);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create the assignment.' });
  }
});

app.delete('/api/admin/class-assignments/:id', requireRole('admin'), (req, res) => {
  const result = db.prepare('DELETE FROM class_teacher_subject WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// =========================================================
// FILE UPLOADS (admission photo / supporting document)
// =========================================================
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  }
});

// =========================================================
// ADMISSIONS
// =========================================================
function nextApplicationId() {
  const year = new Date().getFullYear();
  const row = db.prepare(`SELECT COUNT(*) AS n FROM admissions WHERE application_id LIKE ?`).get(`LM-${year}-%`);
  const seq = String(row.n + 1).padStart(4, '0');
  return `LM-${year}-${seq}`;
}

app.post('/api/admissions', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'document', maxCount: 1 }]), (req, res) => {
  const b = req.body;
  const required = ['student_name', 'dob', 'gender', 'class_applied_for', 'guardian_name', 'guardian_relationship', 'guardian_contact', 'home_address'];
  for (const field of required) {
    if (!b[field] || !String(b[field]).trim()) return res.status(400).json({ error: `Missing required field: ${field}` });
  }
  const applicationId = nextApplicationId();
  const photoPath = req.files?.photo?.[0] ? `/uploads/${req.files.photo[0].filename}` : null;
  const documentPath = req.files?.document?.[0] ? `/uploads/${req.files.document[0].filename}` : null;

  const stmt = db.prepare(`
    INSERT INTO admissions (application_id, student_name, dob, gender, previous_school, class_applied_for,
      guardian_name, guardian_relationship, guardian_contact, guardian_email, home_address, additional_info,
      photo_path, document_path, status)
    VALUES (@application_id, @student_name, @dob, @gender, @previous_school, @class_applied_for,
      @guardian_name, @guardian_relationship, @guardian_contact, @guardian_email, @home_address, @additional_info,
      @photo_path, @document_path, 'pending')
  `);
  try {
    stmt.run({
      application_id: applicationId, student_name: b.student_name, dob: b.dob, gender: b.gender,
      previous_school: b.previous_school || null, class_applied_for: b.class_applied_for,
      guardian_name: b.guardian_name, guardian_relationship: b.guardian_relationship,
      guardian_contact: b.guardian_contact, guardian_email: b.guardian_email || null,
      home_address: b.home_address, additional_info: b.additional_info || null,
      photo_path: photoPath, document_path: documentPath
    });
    res.status(201).json({ applicationId, status: 'pending' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save application. Please try again.' });
  }
});

app.get('/api/admissions', requireRole('admin'), (req, res) => {
  const { status, q } = req.query;
  let sql = 'SELECT * FROM admissions WHERE 1=1';
  const params = [];
  if (status && ['pending', 'approved', 'rejected'].includes(status)) { sql += ' AND status = ?'; params.push(status); }
  if (q) { sql += ' AND (student_name LIKE ? OR application_id LIKE ? OR guardian_name LIKE ?)'; const like = `%${q}%`; params.push(like, like, like); }
  sql += ' ORDER BY submitted_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/admissions/:id', requireRole('admin'), (req, res) => {
  const row = db.prepare('SELECT * FROM admissions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.patch('/api/admissions/:id', requireRole('admin'), (req, res) => {
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const result = db.prepare(`UPDATE admissions SET status = ?, decided_at = datetime('now'), decided_by = ? WHERE id = ?`)
    .run(status, req.session.user.id, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, status });
});

app.delete('/api/admissions/:id', requireRole('admin'), (req, res) => {
  const result = db.prepare('DELETE FROM admissions WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// =========================================================
// ANNOUNCEMENTS
// =========================================================

// Public: only school-wide announcements
app.get('/api/announcements', (req, res) => {
  const rows = db.prepare(`
    SELECT id, title, body, audience, posted_by, announcement_date
    FROM announcements WHERE is_published = 1 AND audience = 'all' ORDER BY announcement_date DESC
  `).all();
  res.json(rows);
});

// Logged-in: announcements relevant to this viewer's role/class
app.get('/api/dashboard/announcements', requireAuth, (req, res) => {
  const u = req.session.user;
  let rows;
  if (u.role === 'admin') {
    rows = db.prepare(`SELECT * FROM announcements ORDER BY announcement_date DESC`).all();
  } else if (u.role === 'teacher') {
    rows = db.prepare(`
      SELECT * FROM announcements WHERE is_published = 1 AND audience IN ('all','teachers')
      ORDER BY announcement_date DESC
    `).all();
  } else {
    const student = db.prepare(`
      SELECT c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.user_id = ?
    `).get(u.id);
    const className = student?.class_name;
    rows = db.prepare(`
      SELECT * FROM announcements WHERE is_published = 1 AND (audience IN ('all','students') OR audience = ?)
      ORDER BY announcement_date DESC
    `).all(`class:${className || '__none__'}`);
  }
  res.json(rows);
});

app.get('/api/announcements/all', requireRole('admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all());
});

app.post('/api/announcements', requireRole('admin'), (req, res) => {
  const { title, body, audience, posted_by, announcement_date, is_published } = req.body;
  if (!title || !body || !posted_by) return res.status(400).json({ error: 'title, body, and posted_by are required' });
  const stmt = db.prepare(`
    INSERT INTO announcements (title, body, audience, posted_by, announcement_date, is_published)
    VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), ?)
  `);
  const result = stmt.run(title, body, audience || 'all', posted_by, announcement_date || null, is_published ? 1 : 0);
  res.status(201).json({ id: result.lastInsertRowid });
});

// Teacher: allowed to post only to students / a specific class - never 'all' or 'teachers'
app.post('/api/teacher/announcements', requireRole('teacher'), (req, res) => {
  const { title, body, audience } = req.body || {};
  if (!title || !body || !audience) return res.status(400).json({ error: 'title, body, and audience are required' });
  if (audience !== 'students' && !audience.startsWith('class:')) {
    return res.status(403).json({ error: "Teachers may only post to 'students' or a specific class." });
  }
  const stmt = db.prepare(`
    INSERT INTO announcements (title, body, audience, posted_by, announcement_date, is_published)
    VALUES (?, ?, ?, ?, datetime('now'), 1)
  `);
  const result = stmt.run(title, body, audience, req.session.user.full_name);
  res.status(201).json({ id: result.lastInsertRowid });
});

app.put('/api/announcements/:id', requireRole('admin'), (req, res) => {
  const { title, body, audience, posted_by, announcement_date } = req.body;
  const result = db.prepare(`
    UPDATE announcements SET title = ?, body = ?, audience = ?, posted_by = ?, announcement_date = ?, updated_at = datetime('now') WHERE id = ?
  `).run(title, body, audience, posted_by, announcement_date, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

app.patch('/api/announcements/:id/publish', requireRole('admin'), (req, res) => {
  const { is_published } = req.body;
  const result = db.prepare(`UPDATE announcements SET is_published = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(is_published ? 1 : 0, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

app.delete('/api/announcements/:id', requireRole('admin'), (req, res) => {
  const result = db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// =========================================================
// TEACHER DASHBOARD DATA
// =========================================================
app.get('/api/teacher/me', requireRole('teacher'), (req, res) => {
  const t = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.session.user.id);
  const classes = db.prepare(`
    SELECT cts.subject, c.name AS class_name FROM class_teacher_subject cts
    JOIN classes c ON c.id = cts.class_id WHERE cts.teacher_id = ?
  `).all(t?.id || -1);
  res.json({ ...req.session.user, teacher: t || null, classes });
});

app.put('/api/teacher/me', requireRole('teacher'), (req, res) => {
  const { bio } = req.body || {};
  db.prepare('UPDATE teachers SET bio = ? WHERE user_id = ?').run(bio || null, req.session.user.id);
  res.json({ ok: true });
});

app.get('/api/teacher/students', requireRole('teacher'), (req, res) => {
  const t = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.session.user.id);
  if (!t) return res.json([]);
  const rows = db.prepare(`
    SELECT DISTINCT s.id, s.full_name, s.roll_no, c.name AS class_name
    FROM class_teacher_subject cts
    JOIN classes c ON c.id = cts.class_id
    JOIN students s ON s.class_id = c.id
    WHERE cts.teacher_id = ?
    ORDER BY c.name, s.full_name
  `).all(t.id);
  res.json(rows);
});

// =========================================================
// STUDENT DASHBOARD DATA
// =========================================================
app.get('/api/student/me', requireRole('student'), (req, res) => {
  const s = db.prepare(`
    SELECT s.*, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.user_id = ?
  `).get(req.session.user.id);
  res.json({ ...req.session.user, student: s || null });
});

// =========================================================
// DYNAMIC SITE CONTENT (principal, teacher profiles, gallery)
// New endpoints only - lives in routes/content.js, uses db/content.db
// =========================================================
app.use(require('./routes/content')({ requireRole }));

app.listen(PORT, () => {
  console.log(`The Learning Minds school site running at http://localhost:${PORT}`);
});
