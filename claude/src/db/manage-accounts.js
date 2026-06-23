/* Account management tool.

   List all accounts:
     node src/db/manage-accounts.js list

   Delete one or more accounts by email (also removes their profile + deliveries):
     node src/db/manage-accounts.js delete maria@flashrush.app jasmine@flashrush.app

   On the live server, prefix with the disk path so it edits the real database:
     DB_PATH=/var/data/flashrush-data.json node src/db/manage-accounts.js list
     DB_PATH=/var/data/flashrush-data.json node src/db/manage-accounts.js delete maria@flashrush.app
*/

import 'dotenv/config';
import db from './db.js';

const [, , command, ...emails] = process.argv;

(async () => {
  await db.init();

  if (command === 'list') {
    const users = db.users.all();
    if (!users.length) { console.log('No accounts found.'); process.exit(0); }
    console.log(`\n${users.length} account(s):\n`);
    for (const u of users) {
      const deliveries = db.deliveries.find(
        (d) => d.customer_id === u.id || d.driver_id === u.id
      ).length;
      console.log(`  [${u.role.padEnd(8)}] ${u.email.padEnd(28)} ${u.name}  (${deliveries} deliveries)`);
    }
    console.log('');
    process.exit(0);
  }

  if (command === 'delete') {
    if (!emails.length) {
      console.error('Provide at least one email to delete.');
      console.error('Example: node src/db/manage-accounts.js delete maria@flashrush.app');
      process.exit(1);
    }
    let removed = 0;
    for (const email of emails) {
      const user = db.users.one((u) => u.email === email);
      if (!user) { console.log(`  - not found: ${email}`); continue; }

      // Remove the user's profile.
      if (user.role === 'driver') {
        const p = db.driverProfiles.one((x) => x.user_id === user.id);
        if (p) db.driverProfiles.remove(p.id);
      } else if (user.role === 'customer') {
        const p = db.customerProfiles.one((x) => x.user_id === user.id);
        if (p) db.customerProfiles.remove(p.id);
      }

      // Remove deliveries tied to this user (as customer or driver).
      const theirDeliveries = db.deliveries.find(
        (d) => d.customer_id === user.id || d.driver_id === user.id
      );
      for (const d of theirDeliveries) db.deliveries.remove(d.id);

      db.users.remove(user.id);
      removed++;
      console.log(`  ✓ deleted: ${email} (${user.role})`);
    }
    await db.drain();
    db.flush();
    console.log(`\nDone. Removed ${removed} account(s).`);
    process.exit(0);
  }

  console.error('Unknown command. Use "list" or "delete <email> [email2 ...]".');
  process.exit(1);
})();
