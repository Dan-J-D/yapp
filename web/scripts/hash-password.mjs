#!/usr/bin/env node
// Usage: npm run hash-password -- 'my password'   (or run with no args to be prompted)
import { hash } from '@node-rs/argon2';
import readline from 'node:readline';

let pw = process.argv[2];
if (!pw) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  pw = await new Promise((r) => rl.question('Password: ', (a) => (rl.close(), r(a))));
}
if (!pw || pw.length < 8) {
  console.error('Use at least 8 characters.');
  process.exit(1);
}
const h = await hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
// Single quotes stop docker compose from interpolating the $ signs.
console.log(`APP_PASSWORD_HASH='${h}'`);
