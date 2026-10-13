// Dynamic website content: principal message, teacher profiles, gallery.
// Mounted from server.js with a single app.use(...) line. Adds NEW endpoints
// only - nothing here changes any existing route.
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const cdb = require('../db/content');

const contentDir = path.join(__dirname, '..', 'public', 'uploads', 'content');
fs.mkdirSync(contentDir, { recursive: true });

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, contentDir),
    filename: (req, file, cb) =>
      cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    const ok = IMAGE_EXT.includes(path.extname(file.originalname).toLowerCase()) && /^image\//.test(file.mimetype);
    ok ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed.'));
  }
});

// Run a multer middleware and turn its errors into clean JSON responses.
const handle = (mw) => (req, res, next) => mw(req, res, (err) => {
  if (!err) return next();
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 5 MB or smaller.'
    : err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT' ? 'Too many files in one upload.'
    : err.message || 'Upload failed.';
  res.status(400).json({ error: msg });
});

const publicPath = (file) => (file ? '/uploads/content/' + file.filename : null);
function safeUnlink(webPath) {
  if (!webPath) return;
  const full = path.resolve(__dirname, '..', 'public', '.' + webPath);
  if (full.startsWith(contentDir + path.sep)) fs.unlink(full, () => {});
}
function discardUploads(req) {
  const files = req.file ? [req.file] : Array.isArray(req.files) ? req.files : [];
  files.forEach(f => fs.unlink(f.path, () => {}));
}
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

module.exports = function contentRoutes({ requireRole }) {
  const router = express.Router();
  const admin = requireRole('admin');

  // ---------- PUBLIC (read-only) ----------
  router.get('/api/content/principal', (req, res) => {
    res.json(cdb.prepare('SELECT name, title, message, photo_path FROM principal WHERE id = 1').get() || null);
  });
  router.get('/api/content/teachers', (req, res) => {
    res.json(cdb.prepare('SELECT id, name, designation, bio, photo_path, sort_order FROM staff_profiles ORDER BY sort_order, id').all());
  });
  router.get('/api/content/gallery', (req, res) => {
    res.json(cdb.prepare('SELECT id, caption, image_path FROM gallery_images ORDER BY id DESC').all());
  });

  // ---------- ADMIN: PRINCIPAL ----------
  router.put('/api/admin/content/principal', admin, handle(upload.single('photo')), (req, res) => {
    const name = clean(req.body.name, 120), title = clean(req.body.title, 160), message = clean(req.body.message, 6000);
    if (!name || !title) { discardUploads(req); return res.status(400).json({ error: 'Name and title are required.' }); }
    const cur = cdb.prepare('SELECT photo_path FROM principal WHERE id = 1').get();
    let photo = cur ? cur.photo_path : null;
    if (req.file) { safeUnlink(photo); photo = publicPath(req.file); }
    else if (req.body.remove_photo === '1') { safeUnlink(photo); photo = null; }
    cdb.prepare(`
      INSERT INTO principal (id, name, title, message, photo_path, updated_at) VALUES (1, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, title = excluded.title, message = excluded.message,
        photo_path = excluded.photo_path, updated_at = datetime('now')
    `).run(name, title, message, photo);
    res.json({ ok: true, photo_path: photo });
  });

  // ---------- ADMIN: TEACHERS ----------
  router.post('/api/admin/content/teachers', admin, handle(upload.single('photo')), (req, res) => {
    const name = clean(req.body.name, 120), designation = clean(req.body.designation, 160), bio = clean(req.body.bio, 3000);
    if (!name || !designation) { discardUploads(req); return res.status(400).json({ error: 'Name and designation are required.' }); }
    const next = (cdb.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM staff_profiles').get()).n;
    const order = Number.isFinite(parseInt(req.body.sort_order, 10)) ? parseInt(req.body.sort_order, 10) : next;
    const r = cdb.prepare('INSERT INTO staff_profiles (name, designation, bio, photo_path, sort_order) VALUES (?, ?, ?, ?, ?)')
      .run(name, designation, bio, publicPath(req.file), order);
    res.status(201).json({ id: r.lastInsertRowid });
  });

  router.put('/api/admin/content/teachers/:id', admin, handle(upload.single('photo')), (req, res) => {
    const row = cdb.prepare('SELECT * FROM staff_profiles WHERE id = ?').get(req.params.id);
    if (!row) { discardUploads(req); return res.status(404).json({ error: 'Teacher not found.' }); }
    const name = clean(req.body.name, 120), designation = clean(req.body.designation, 160), bio = clean(req.body.bio, 3000);
    if (!name || !designation) { discardUploads(req); return res.status(400).json({ error: 'Name and designation are required.' }); }
    const parsed = parseInt(req.body.sort_order, 10);
    const order = Number.isFinite(parsed) ? parsed : row.sort_order;
    let photo = row.photo_path;
    if (req.file) { safeUnlink(photo); photo = publicPath(req.file); }
    else if (req.body.remove_photo === '1') { safeUnlink(photo); photo = null; }
    cdb.prepare(`UPDATE staff_profiles SET name = ?, designation = ?, bio = ?, photo_path = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(name, designation, bio, photo, order, row.id);
    res.json({ ok: true });
  });

  router.delete('/api/admin/content/teachers/:id', admin, (req, res) => {
    const row = cdb.prepare('SELECT photo_path FROM staff_profiles WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Teacher not found.' });
    cdb.prepare('DELETE FROM staff_profiles WHERE id = ?').run(req.params.id);
    safeUnlink(row.photo_path);
    res.json({ ok: true });
  });

  // ---------- ADMIN: GALLERY ----------
  router.post('/api/admin/content/gallery', admin, handle(upload.array('images', 20)), (req, res) => {
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'Please choose at least one image.' });
    const caption = clean(req.body.caption, 200);
    const ins = cdb.prepare('INSERT INTO gallery_images (caption, image_path) VALUES (?, ?)');
    cdb.transaction(() => req.files.forEach(f => ins.run(caption, publicPath(f))))();
    res.status(201).json({ added: req.files.length });
  });

  router.put('/api/admin/content/gallery/:id', admin, (req, res) => {
    const r = cdb.prepare('UPDATE gallery_images SET caption = ? WHERE id = ?').run(clean(req.body && req.body.caption, 200), req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'Image not found.' });
    res.json({ ok: true });
  });

  router.delete('/api/admin/content/gallery/:id', admin, (req, res) => {
    const row = cdb.prepare('SELECT image_path FROM gallery_images WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Image not found.' });
    cdb.prepare('DELETE FROM gallery_images WHERE id = ?').run(req.params.id);
    safeUnlink(row.image_path);
    res.json({ ok: true });
  });

  return router;
};
