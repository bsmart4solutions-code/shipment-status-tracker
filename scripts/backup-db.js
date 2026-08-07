#!/usr/bin/env node
/**
 * Local database backup.
 *
 * Reads DATABASE_URL from backend/.env so the password lives in exactly one
 * place and never lands in git (this file is committed; .env is ignored).
 * Runs pg_dump into ../db-backup and keeps the most recent KEEP files.
 *
 * Usage:  node scripts/backup-db.js            (or double-click backup-db.bat)
 * Exit code is non-zero on failure so a scheduled task shows as failed
 * rather than silently doing nothing.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const KEEP = 30; // roughly a month of daily backups
const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'backend', '.env');
// Kept OUTSIDE the repo: a backup inside the working tree is one `git clean`
// away from being deleted along with the thing it was protecting.
const OUT_DIR = path.resolve(ROOT, '..', 'db-backup');
// Second tier, never rotated. The daily backups above answer "the disk died,
// give me yesterday"; they cannot answer "the tax office wants FY2026", because
// after 30 days that month is gone. Malaysian SST requires records to be kept
// for SEVEN YEARS, so one dump per month is promoted here and never deleted.
// Cost is trivial — ~220 KB × 12 × 7 ≈ 18 MB for the full retention period —
// which is why nothing here prunes: deleting a statutory record automatically
// is a far worse failure than keeping a few spare megabytes.
const ARCHIVE_DIR = path.join(OUT_DIR, 'archive');

function fail(msg) {
  console.error('BACKUP FAILED: ' + msg);
  process.exit(1);
}

if (!fs.existsSync(ENV_FILE)) fail('cannot find ' + ENV_FILE);
const envText = fs.readFileSync(ENV_FILE, 'utf8');
const m = envText.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
if (!m) fail('DATABASE_URL not found in backend/.env');

let url;
try { url = new URL(m[1]); } catch { return fail('DATABASE_URL is not a valid URL'); }

const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const host = url.hostname;
const port = url.port || '5432';
const database = url.pathname.replace(/^\//, '');

// Prefer pg_dump from the known install, fall back to PATH.
const CANDIDATES = [
  'C:/PostgreSQL/pgsql/bin/pg_dump.exe',
  'C:/Program Files/PostgreSQL/17/bin/pg_dump.exe',
  'C:/Program Files/PostgreSQL/16/bin/pg_dump.exe',
  'pg_dump',
];
const pgDump = CANDIDATES.find((c) => c === 'pg_dump' || fs.existsSync(c)) || 'pg_dump';

fs.mkdirSync(OUT_DIR, { recursive: true });
// UTC, sortable: 20260803T013045 -> 20260803013045
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const outFile = path.join(OUT_DIR, `${database}-${stamp}.sql`);

console.log(`Backing up ${database} from ${host}:${port} …`);
const res = spawnSync(pgDump, [
  '-h', host, '-p', port, '-U', user, '-d', database,
  '--no-owner', '--no-acl', '-f', outFile,
], { env: { ...process.env, PGPASSWORD: password }, encoding: 'utf8' });

if (res.error) fail(`could not run pg_dump (${pgDump}): ${res.error.message}`);
if (res.status !== 0) fail(`pg_dump exited ${res.status}\n${res.stderr || ''}`);

const size = fs.statSync(outFile).size;
// A dump that is suspiciously small almost certainly did not capture the data;
// better to fail loudly than to leave a useless file that looks like a backup.
if (size < 10_000) fail(`dump is only ${size} bytes — that is not a real backup`);
console.log(`  -> ${path.basename(outFile)}  (${(size / 1024).toFixed(0)} KB)`);

// Promote the first successful dump of each calendar month into the archive.
// Done by copying the dump we just verified, not by running pg_dump twice —
// the archived file is then byte-identical to one that already passed the
// size check above.
fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
const month = stamp.slice(0, 6); // YYYYMM
const archiveFile = path.join(ARCHIVE_DIR, `${database}-archive-${month}.sql`);
if (fs.existsSync(archiveFile)) {
  console.log(`Archive for ${month} already exists — left untouched.`);
} else {
  fs.copyFileSync(outFile, archiveFile);
  console.log(`  -> archive/${path.basename(archiveFile)}  (permanent, never rotated)`);
}

// Rotation: keep the newest KEEP dumps of this database. Only the daily tier is
// touched — archives live in a subdirectory, and a directory entry does not end
// in .sql, so it can never match this filter.
const mine = fs.readdirSync(OUT_DIR)
  .filter((f) => f.startsWith(database + '-') && f.endsWith('.sql'))
  .sort()
  .reverse();
const stale = mine.slice(KEEP);
for (const f of stale) fs.unlinkSync(path.join(OUT_DIR, f));
console.log(`Kept ${Math.min(mine.length, KEEP)} daily backup(s)${stale.length ? `, removed ${stale.length} old` : ''}.`);

const archives = fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith('.sql')).sort();
if (archives.length) {
  const span = `${archives[0].match(/(\d{6})\.sql$/)?.[1]} … ${archives[archives.length - 1].match(/(\d{6})\.sql$/)?.[1]}`;
  console.log(`Archive: ${archives.length} monthly snapshot(s) retained (${span}).`);
}
console.log('Location: ' + OUT_DIR);
