// Run once to create the very first Principal/Admin account:
//   npm run create-admin
// After that, the Principal/Admin creates every other account from the dashboard.
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
const askHidden = (q) => new Promise((resolve) => {
  process.stdout.write(q);
  const stdin = process.stdin;
  stdin.resume();
  stdin.setRawMode(true);
  let input = '';
  const onData = (char) => {
    char = char.toString('utf8');
    if (char === '\n' || char === '\r' || char === '\u0004') {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      resolve(input);
    } else if (char === '\u0003') {
      process.exit(1);
    } else if (char === '\u007f') {
      input = input.slice(0, -1);
    } else {
      input += char;
    }
  };
  stdin.on('data', onData);
});

(async () => {
  console.log('Create the first Principal/Admin account for The Learning Minds Higher Secondary School.\n');
  const full_name = await ask('Full name (e.g. Sir Hader): ');
  const username = await ask('Username: ');
  const password = await askHidden('Temporary password (min 6 characters): ');

  if (!full_name.trim() || !username.trim() || password.length < 6) {
    console.error('\nAll fields are required and the password must be at least 6 characters.');
    process.exit(1);
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) {
    console.error('\nThat username already exists.');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (username, password_hash, role, full_name, is_active, must_change_password)
    VALUES (?, ?, 'admin', ?, 1, 1)
  `).run(username.trim(), hash, full_name.trim());

  console.log(`\nAdmin account created for "${full_name.trim()}". Log in at /login.html with username "${username.trim()}".`);
  console.log('You will be asked to set a new password on first login.');
  rl.close();
  process.exit(0);
})();
