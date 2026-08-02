#!/usr/bin/env node
/**
 * Remove the seeded demo records so the system can start on real data.
 *
 * DESTRUCTIVE, so it is a dry run unless you pass --yes, and it takes a full
 * backup before touching anything.
 *
 * What it will NOT remove:
 *   - anything you created yourself (only the exact seed names are targeted)
 *   - any demo record still referenced by one of your own records. A demo
 *     vendor sitting on a real quotation line is kept and reported, because
 *     deleting it would either fail on the foreign key or quietly damage your
 *     quotation.
 *   - users, roles, permissions, the services catalog, exchange rates,
 *     settings, the company profile and the numbering sequences.
 *
 * Usage:
 *   node scripts/clear-demo-data.js          show what would be removed
 *   node scripts/clear-demo-data.js --yes    actually remove it
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'backend', '.env');

// Exactly the names prisma/seed.ts creates. Anything else is yours.
const DEMO_CUSTOMERS = ['Sunrise Electronics Sdn. Bhd.', 'Golden Harvest Trading Ltd.'];
const DEMO_VENDORS = ['SwiftAir Cargo Sdn. Bhd.', 'BlueOcean Shipping Lines', 'KL Express Haulage'];

function fail(msg) { console.error('FAILED: ' + msg); process.exit(1); }

if (!fs.existsSync(ENV_FILE)) fail('cannot find ' + ENV_FILE);
const m = fs.readFileSync(ENV_FILE, 'utf8').match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
if (!m) fail('DATABASE_URL not found in backend/.env');
const url = new URL(m[1]);
const CONN = {
  host: url.hostname, port: url.port || '5432',
  user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ''),
};

const bin = ['C:/PostgreSQL/pgsql/bin', 'C:/Program Files/PostgreSQL/17/bin', 'C:/Program Files/PostgreSQL/16/bin']
  .find((d) => fs.existsSync(path.join(d, 'psql.exe')));
const psql = bin ? path.join(bin, 'psql.exe') : 'psql';

function q(sql) {
  const r = spawnSync(psql, ['-h', CONN.host, '-p', CONN.port, '-U', CONN.user, '-d', CONN.database,
    '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { env: { ...process.env, PGPASSWORD: CONN.password }, encoding: 'utf8' });
  if (r.status !== 0) fail('query failed:\n' + (r.stderr || ''));
  return r.stdout.trim().split('\n').filter(Boolean);
}
function exec(sql) {
  const r = spawnSync(psql, ['-h', CONN.host, '-p', CONN.port, '-U', CONN.user, '-d', CONN.database,
    '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { env: { ...process.env, PGPASSWORD: CONN.password }, encoding: 'utf8' });
  if (r.status !== 0) fail('statement failed (nothing was committed):\n' + (r.stderr || ''));
  return r.stdout;
}

const list = (arr) => arr.map((s) => `'${s.replace(/'/g, "''")}'`).join(',');
const CUST_IN = `SELECT id FROM customers WHERE "companyName" IN (${list(DEMO_CUSTOMERS)})`;
const VEND_IN = `SELECT id FROM vendors WHERE name IN (${list(DEMO_VENDORS)})`;

// ── Survey ────────────────────────────────────────────────────────────────
const demoCustomers = q(`SELECT code||' — '||"companyName" FROM customers WHERE "companyName" IN (${list(DEMO_CUSTOMERS)}) ORDER BY code`);
const counts = q(`SELECT
    (SELECT count(*) FROM quotations WHERE "customerId" IN (${CUST_IN}))||'|'||
    (SELECT count(*) FROM jobs      WHERE "customerId" IN (${CUST_IN}))||'|'||
    (SELECT count(*) FROM invoices  WHERE "customerId" IN (${CUST_IN}))||'|'||
    (SELECT count(*) FROM bookings  WHERE "customerId" IN (${CUST_IN}))`)[0].split('|');

// A demo vendor is only removable once nothing outside the demo set points at it.
const keptVendors = q(`
  SELECT v.code||' — '||v.name||'   (still used by: '||
    CASE WHEN EXISTS (SELECT 1 FROM quotation_items qi JOIN quotations qq ON qq.id=qi."quotationId"
                      WHERE qi."vendorId"=v.id AND qq."customerId" NOT IN (${CUST_IN}))
         THEN 'a quotation of yours' ELSE '' END ||
    CASE WHEN EXISTS (SELECT 1 FROM jobs j WHERE j."vendorId"=v.id AND j."customerId" NOT IN (${CUST_IN}))
         THEN ' a job of yours' ELSE '' END ||
    CASE WHEN EXISTS (SELECT 1 FROM vendor_bills b WHERE b."vendorId"=v.id) THEN ' a vendor bill' ELSE '' END || ')'
  FROM vendors v
  WHERE v.name IN (${list(DEMO_VENDORS)})
    AND ( EXISTS (SELECT 1 FROM quotation_items qi JOIN quotations qq ON qq.id=qi."quotationId"
                  WHERE qi."vendorId"=v.id AND qq."customerId" NOT IN (${CUST_IN}))
       OR EXISTS (SELECT 1 FROM jobs j WHERE j."vendorId"=v.id AND j."customerId" NOT IN (${CUST_IN}))
       OR EXISTS (SELECT 1 FROM vendor_bills b WHERE b."vendorId"=v.id) )
  ORDER BY v.code`);
const removableVendors = q(`
  SELECT v.code||' — '||v.name FROM vendors v
  WHERE v.name IN (${list(DEMO_VENDORS)})
    AND NOT EXISTS (SELECT 1 FROM quotation_items qi JOIN quotations qq ON qq.id=qi."quotationId"
                    WHERE qi."vendorId"=v.id AND qq."customerId" NOT IN (${CUST_IN}))
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j."vendorId"=v.id AND j."customerId" NOT IN (${CUST_IN}))
    AND NOT EXISTS (SELECT 1 FROM vendor_bills b WHERE b."vendorId"=v.id)
  ORDER BY v.code`);
const keptCustomers = q(`SELECT code||' — '||"companyName" FROM customers WHERE "companyName" NOT IN (${list(DEMO_CUSTOMERS)}) ORDER BY code`);

console.log('\n=== WILL BE REMOVED ===\n');
console.log('Demo customers:');
demoCustomers.forEach((c) => console.log('  - ' + c));
console.log(`\n  …and everything hanging off them: ${counts[0]} quotation(s), ${counts[1]} job(s), ${counts[2]} invoice(s), ${counts[3]} booking(s),`);
console.log('  plus their credit/debit notes, payments, tracking events and documents.');
console.log('\nDemo vendors:');
removableVendors.length ? removableVendors.forEach((v) => console.log('  - ' + v)) : console.log('  (none removable)');

console.log('\n=== WILL BE KEPT ===\n');
console.log('Your customers:');
keptCustomers.length ? keptCustomers.forEach((c) => console.log('  + ' + c)) : console.log('  (none)');
if (keptVendors.length) {
  console.log('\nDemo vendors kept because your own records reference them:');
  keptVendors.forEach((v) => console.log('  + ' + v));
  console.log('\n  Delete these by hand later if you want, after repointing the records above.');
}
console.log('\nAlso untouched: users, roles, permissions, services catalog, exchange rates,');
console.log('settings, company profile and the document numbering sequences.');

if (!process.argv.includes('--yes')) {
  console.log('\n--- DRY RUN. Nothing was changed. Re-run with --yes to apply. ---\n');
  process.exit(0);
}

// ── Apply ─────────────────────────────────────────────────────────────────
console.log('\nTaking a full backup first…');
const bk = spawnSync(process.execPath, [path.join(__dirname, 'backup-db.js')], { encoding: 'utf8' });
if (bk.status !== 0) fail('backup failed, refusing to delete anything:\n' + (bk.stderr || bk.stdout));
console.log(bk.stdout.trim());

// One transaction: any failure leaves the database exactly as it was.
// Order follows the foreign keys — children before parents.
console.log('\nRemoving demo data…');
exec(`
BEGIN;
CREATE TEMP TABLE _c AS ${CUST_IN};
CREATE TEMP TABLE _j AS SELECT id FROM jobs WHERE "customerId" IN (SELECT id FROM _c);
CREATE TEMP TABLE _i AS SELECT id FROM invoices WHERE "customerId" IN (SELECT id FROM _c);
CREATE TEMP TABLE _q AS SELECT id FROM quotations WHERE "customerId" IN (SELECT id FROM _c);
CREATE TEMP TABLE _n AS SELECT id FROM credit_debit_notes WHERE "customerId" IN (SELECT id FROM _c);
CREATE TEMP TABLE _b AS SELECT id FROM vendor_bills WHERE "jobId" IN (SELECT id FROM _j);

DELETE FROM vendor_payments        WHERE "billId"     IN (SELECT id FROM _b);
DELETE FROM vendor_bill_items      WHERE "billId"     IN (SELECT id FROM _b);
DELETE FROM vendor_bills           WHERE id           IN (SELECT id FROM _b);
DELETE FROM credit_debit_note_items WHERE "noteId"    IN (SELECT id FROM _n);
DELETE FROM credit_debit_notes     WHERE id           IN (SELECT id FROM _n);
DELETE FROM invoice_payments       WHERE "invoiceId"  IN (SELECT id FROM _i);
DELETE FROM invoice_items          WHERE "invoiceId"  IN (SELECT id FROM _i);
DELETE FROM invoices               WHERE id           IN (SELECT id FROM _i);
DELETE FROM job_tracking_events    WHERE "jobId"      IN (SELECT id FROM _j);
DELETE FROM job_documents          WHERE "jobId"      IN (SELECT id FROM _j);
DELETE FROM jobs                   WHERE id           IN (SELECT id FROM _j);
DELETE FROM bookings               WHERE "customerId" IN (SELECT id FROM _c);
DELETE FROM quotation_items        WHERE "quotationId" IN (SELECT id FROM _q);
DELETE FROM quotation_revisions    WHERE "quotationId" IN (SELECT id FROM _q);
DELETE FROM quotations             WHERE id           IN (SELECT id FROM _q);
DELETE FROM customer_ratings       WHERE "customerId" IN (SELECT id FROM _c);
DELETE FROM customer_contacts      WHERE "customerId" IN (SELECT id FROM _c);
DELETE FROM customer_addresses     WHERE "customerId" IN (SELECT id FROM _c);
DELETE FROM customer_documents     WHERE "customerId" IN (SELECT id FROM _c);
DELETE FROM customer_bank_accounts WHERE "customerId" IN (SELECT id FROM _c);
DELETE FROM audit_logs             WHERE "entityId"::text IN (SELECT id::text FROM _c UNION SELECT id::text FROM _j UNION SELECT id::text FROM _i UNION SELECT id::text FROM _q);
DELETE FROM customers              WHERE id           IN (SELECT id FROM _c);

CREATE TEMP TABLE _v AS
  SELECT v.id FROM vendors v
  WHERE v.name IN (${list(DEMO_VENDORS)})
    AND NOT EXISTS (SELECT 1 FROM quotation_items qi WHERE qi."vendorId"=v.id)
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j."vendorId"=v.id)
    AND NOT EXISTS (SELECT 1 FROM vendor_bills b WHERE b."vendorId"=v.id)
    AND NOT EXISTS (SELECT 1 FROM bookings bk WHERE bk."vendorId"=v.id);
DELETE FROM vendor_service_rates   WHERE "vendorId" IN (SELECT id FROM _v);
DELETE FROM vendor_ratings         WHERE "vendorId" IN (SELECT id FROM _v);
DELETE FROM vendor_contacts        WHERE "vendorId" IN (SELECT id FROM _v);
DELETE FROM vendor_addresses       WHERE "vendorId" IN (SELECT id FROM _v);
DELETE FROM vendor_documents       WHERE "vendorId" IN (SELECT id FROM _v);
DELETE FROM vendor_bank_accounts   WHERE "vendorId" IN (SELECT id FROM _v);
DELETE FROM vendors                WHERE id IN (SELECT id FROM _v);
COMMIT;
`);

console.log('Done.\n');
const left = q(`SELECT 'customers='||(SELECT count(*) FROM customers)||'  vendors='||(SELECT count(*) FROM vendors)||'  quotations='||(SELECT count(*) FROM quotations)||'  jobs='||(SELECT count(*) FROM jobs)||'  invoices='||(SELECT count(*) FROM invoices)`)[0];
console.log('Remaining: ' + left);
console.log('\nDocument numbering was left as-is so historical numbers stay unique.');
console.log('To restart numbering, edit the sequences in Settings → System Configuration.');
