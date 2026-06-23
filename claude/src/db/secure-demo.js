/* Secure the demo accounts by changing their passwords.
   Run once on the live server:  node src/db/secure-demo.js NEWPASSWORD

   This changes the password for alex@, marcus@, jasmine@, sara@, maria@, and sarah@
   to the password you provide, so the public demo passwords from setup no longer work.
   You can still log in with the demo emails using your new password. */

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from './db.js';

const newPw = process.argv[2];

if (!newPw || newPw.length < 6) {
  console.error('Usage: node src/db/secure-demo.js <new-password>   (min 6 chars)');
  process.exit(1);
}

const demoEmails = [
  'alex@flashrush.app',
  'marcus@flashrush.app',
  'jasmine@flashrush.app',
  'sara@flashrush.app',
  'maria@flashrush.app',
  'sarah@flashrush.app',
];

(async () => {
  await db.init();
  const hash = bcrypt.hashSync(newPw, 10);
  let changed = 0;
  for (const email of demoEmails) {
    const user = db.users.one((u) => u.email === email);
    if (user) {
      db.users.update(user.id, { password_hash: hash });
      changed++;
      console.log('  ✓ password reset for', email);
    }
  }
  await db.drain();
  db.flush();
  console.log(`\nDone. Changed ${changed} demo account password(s).`);
  console.log('All demo accounts now use the password you provided.');
  console.log('The old public passwords (password123 / admin123) no longer work.');
  process.exit(0);
})();
