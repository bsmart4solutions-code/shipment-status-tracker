#!/usr/bin/env node
/**
 * Restore drill — proves a backup can actually be restored.
 *
 * "The scheduled task succeeded" only proves a file was written. The classic
 * backup failure is discovering, on the day you need it, that the file was
 * never restorable. This restores the newest dump into a THROWAWAY database,
 * counts what came back, and drops it again.
 *
 * The live database is never touched: it is only read from .env for connection
 * details, and every statement runs against the temporary database.
 *
 * Usage:  node scripts/verify-backup.js [backup-file.sql]
 * Exit code is non-zero on failure, so this can be scheduled too.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'backend', '.env');
const OUT_DIR = path.resolve(ROOT, '..', 'db-backup');
const TMP_DB = 'restore_drill_tmp';

function fail(msg) {
  console.error('DRILL FAILED: ' + msg);
  process.exit(1);
}

if (!fs.existsSync(ENV_FILE)) fail('cannot find ' + ENV_FILE);
const m = fs.readFileSync(ENV_FILE, 'utf8').match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
if (!m) fail('DATABASE_URL not found in backend/.env');

let url;
try { url = new URL(m[1]); } catch { return fail('DATABASE_URL is not a valid URL'); }

const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const host = url.hostname;
const port = url.port || '5432';
const database = url.pathname.replace(/^\//, '');

const CANDIDATES = [
  'C:/PostgreSQL/pgsql/bin/psql.exe',
  'C:/Program Files/PostgreSQL/17/bin/psql.exe',
  'C:/Program Files/PostgreSQL/16/bin/psql.exe',
  'psql',
];
const psql = CANDIDATES.find((c) => c === 'psql' || fs.existsSync(c)) || 'psql';

// Pick the file: an explicit argument, otherwise the newest dump.
let backup = process.argv[2];
if (backup) {
  if (!path.isAbsolute(backup)) backup = path.join(OUT_DIR, backup);
  if (!fs.existsSync(backup)) fail('no such backup: ' + backup);
} else {
  if (!fs.existsSync(OUT_DIR)) fail('no backup directory at ' + OUT_DIR);
  const files = fs.readdirSync(OUT_DIR)
    .filter((f) => f.startsWith(database + '-') && f.endsWith('.sql'))
    .sort()
    .reverse();
  if (!files.length) fail('no backups found in ' + OUT_DIR);
  backup = path.join(OUT_DIR, files[0]);
}

const env = { ...process.env, PGPASSWORD: password };
const run = (db, args) =>
  spawnSync(psql, ['-h', host, '-p', port, '-U', user, '-d', db, ...args], { env, encoding: 'utf8' });

console.log(`Restore drill using ${path.basename(backup)}`);
console.log(`  target: throwaway database "${TMP_DB}" on ${host}:${port}`);
console.log(`  the live database "${database}" is NOT touched.\n`);

// Always try to clean up, even if the drill throws part-way through.
const dropTmp = () => run('postgres', ['-q', '-c', `DROP DATABASE IF EXISTS ${TMP_DB};`]);

let exitCode = 0;
try {
  dropTmp();
  const created = run('postgres', ['-q', '-c', `CREATE DATABASE ${TMP_DB};`]);
  if (created.status !== 0) fail(`could not create the temporary database\n${created.stderr || ''}`);

  const restored = run(TMP_DB, ['-q', '-v', 'ON_ERROR_STOP=0', '-f', backup]);
  const errors = (restored.stderr || '').split(/\r?\n/).filter((l) => /error/i.test(l));
  if (errors.length) {
    console.error(`  ${errors.length} error(s) during restore:`);
    errors.slice(0, 10).forEach((e) => console.error('    ' + e));
    exitCode = 1;
  } else {
    console.log('  restore completed with 0 errors.');
  }

  const TABLES = ['users', 'customers', 'vendors', 'quotations', 'jobs', 'invoices', 'bookings', 'vendor_bills'];
  const counts = TABLES.map((t) => `SELECT '${t}' AS t, count(*) AS n FROM ${t}`).join(' UNION ALL ');
  const res = run(TMP_DB, ['-t', '-A', '-F', ' ', '-c', counts]);
  if (res.status !== 0) {
    console.error('  could not read the restored data:\n' + (res.stderr || ''));
    exitCode = 1;
  } else {
    console.log('\n  restored contents:');
    let total = 0;
    for (const line of res.stdout.trim().split(/\r?\n/)) {
      const [t, n] = line.trim().split(/\s+/);
      if (!t) continue;
      total += Number(n) || 0;
      console.log(`    ${t.padEnd(15)} ${n}`);
    }
    // A restore that "succeeds" into an empty database is not a usable backup.
    if (total === 0) {
      console.error('\n  every table is empty — this backup would NOT save you.');
      exitCode = 1;
    }
  }
} finally {
  dropTmp();
  console.log(`\n  temporary database dropped.`);
}

console.log(exitCode === 0 ? '\nDRILL PASSED — this backup is restorable.' : '\nDRILL FAILED — see above.');
process.exit(exitCode);
