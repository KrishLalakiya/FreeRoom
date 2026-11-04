#!/usr/bin/env node

/**
 * Print a bcrypt hash for an admin password, for use in ADMIN_USERS.
 *
 * Usage: npm run hash-password
 * Then set ADMIN_USERS=you@example.com:<hash> (comma-separate multiple admins).
 *
 * The password is read from stdin rather than an argument so it stays out of shell history.
 */

import readline from 'readline';
import bcrypt from 'bcryptjs';

const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

rl.question('Admin password: ', (password) => {
  rl.close();
  if (!password) {
    console.error('No password entered.');
    process.exit(1);
  }
  console.log(bcrypt.hashSync(password, 12));
});
