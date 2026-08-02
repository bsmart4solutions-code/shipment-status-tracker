#!/usr/bin/env node
/**
 * Restore the local database from a backup file.
 *
 * DESTRUCTIVE: this drops and recreates the public schema before loading the
 * dump, so everything currently in the database is replaced. It therefore
 * refuses to run unless the caller passes --yes, and it takes a safety backup
 * of the current state first — restoring the wrong file should never be the
 * end of the story.
 *
 * Usage:
 *   node scripts/restore-db.js                 list available backups
 *   node scripts/restore-db.js <file> --yes    restore that file
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'backend', '.env');
const OUT_DIR = path.resolve(ROOT, '..', 'db-backup');

function fail(msg) { console.error('RESTORE FAILED: ' + msg); process.exit(1); }

if (!fs.existsSync(ENV_FILE)) fail('cannot find ' + ENV_FILE);
const m = fs.readFileSync(ENV_FILE, 'utf8').match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
if (!m) fail('DATABASE_URL not found in backend/.env');
const url = new URL(m[1]);
const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const host = url.hostname;
const port = url.port || '5432';
const database = url.pathname.replace(/^\//, '');

const bin = ['C:/PostgreSQL/pgsql/bin', 'C:/Program Files/PostgreSQL/17/bin', 'C:/Program Files/PostgreSQL/16/bin']
  .find((d) => fs.existsSync(path.join(d, 'psql.exe')));
const psql = bin ? path.join(bin, 'psql.exe') : 'psql';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const confirmed = args.includes('--yes');

const available = fs.existsSync(OUT_DIR)
  ? fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.sql')).sort().reverse()
  : [];

if (!target) {
  console.log('Available backups in ' + OUT_DIR + ':\n');
  if (!available.length) console.log('  (none)');
  for (const f of available) {
    const s = fs.statSync(path.join(OUT_DIR, f));
    console.log(`  ${f}   ${(s.size / 1024).toFixed(0)} KB   ${s.mtime.toLocaleString()}`);
  }
  console.log('\nTo restore:  node scripts/restore-db.js <filename> --yes');
  console.log('WARNING: restoring REPLACES everything currently in the database.');
  process.exit(0);
}

const file = path.isAbsolute(target) ? target : path.join(OUT_DIR, target);
if (!fs.existsSync(file)) fail('no such backup: ' + file);

if (!confirmed) {
  console.log('About to REPLACE the entire "' + database + '" database with:');
  console.log('  ' + file);
  console.log('\nEverything currently in the database will be lost.');
  console.log('Re-run with --yes if that is really what you want.');
  process.exit(1);
}

// Safety net: snapshot the current state before destroying it.
console.log('Taking a safety backup of the current database first…');
const pre = spawnSync(process.execPath, [path.join(__dirname, 'backup-db.js')], { encoding: 'utf8' });
if (pre.status !== 0) fail('safety backup failed, refusing to restore:\n' + (pre.stderr || pre.stdout));
console.log(pre.stdout.trim());

const run = (sql) => spawnSync(psql, ['-h', host, '-p', port, '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', sql],
  { env: { ...process.env, PGPASSWORD: password }, encoding: 'utf8' });

console.log('\nClearing the current schema…');
const drop = run('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
if (drop.status !== 0) fail('could not clear the schema:\n' + drop.stderr);

console.log('Loading ' + path.basename(file) + ' …');
const load = spawnSync(psql, ['-h', host, '-p', port, '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-f', file],
  { env: { ...process.env, PGPASSWORD: password }, encoding: 'utf8' });
if (load.status !== 0) fail('restore failed — the safety backup above still has your data:\n' + load.stderr);

console.log('\nRestored. Restart the backend so it reconnects cleanly.');
