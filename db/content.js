// Separate SQLite file for the editable website content (principal, teacher
// profiles, gallery). It lives NEXT TO school.db and never opens, alters or
// clears it - school.db is left completely untouched by these features.
const path = require('path');
const Database = require('better-sqlite3');

const cdb = new Database(path.join(__dirname, 'content.db'));
cdb.pragma('journal_mode = WAL');

cdb.exec(`
CREATE TABLE IF NOT EXISTS principal (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  photo_path TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS staff_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  designation TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  photo_path TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS gallery_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caption TEXT NOT NULL DEFAULT '',
  image_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS content_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// One-time seed so the public pages keep showing the people that used to be
// hard-coded in index.html. The flag stops it ever re-seeding, so anything the
// admin deletes stays deleted.
const seeded = cdb.prepare(`SELECT value FROM content_meta WHERE key = 'seeded_v1'`).get();
if (!seeded) {
  cdb.transaction(() => {
    cdb.prepare(`INSERT OR IGNORE INTO principal (id, name, title, message) VALUES (1, ?, ?, '')`)
      .run('Sir Hader', 'Principal, The Learning Minds Higher Secondary School');
    const ins = cdb.prepare(`INSERT INTO staff_profiles (name, designation, bio, sort_order) VALUES (?, ?, '', ?)`);
    [
      ['Sir Saddam', 'Mathematics Teacher'],
      ['Sir Bashir', 'Physics Teacher'],
      ['Sir Babar', 'Islamiat & Computer Science Teacher'],
      ['Sir Nowroz', 'Urdu Teacher'],
      ['Sir Nake Alam', 'Computer Science Teacher']
    ].forEach(([n, d], i) => ins.run(n, d, i + 1));
    cdb.prepare(`INSERT INTO content_meta (key, value) VALUES ('seeded_v1', '1')`).run();
  })();
}

module.exports = cdb;
