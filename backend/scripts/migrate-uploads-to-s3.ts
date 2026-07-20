/**
 * One-off migration: copy every locally-stored document binary to the
 * configured S3-compatible bucket (Cloudflare R2) and verify each object by
 * re-fetching it. Idempotent — objects already present and byte-identical
 * are skipped, so the script can be re-run safely.
 *
 * Usage (env must contain DATABASE_URL and the four S3_* variables):
 *   npx ts-node scripts/migrate-uploads-to-s3.ts          # dry-run report
 *   npx ts-node scripts/migrate-uploads-to-s3.ts --apply  # upload + verify
 *
 * Local files are never deleted by this script — after verifying in the app,
 * remove the UPLOAD_DIR contents manually.
 */
import { PrismaClient } from '@prisma/client';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import type { Readable } from 'stream';

const APPLY = process.argv.includes('--apply');
const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR || './uploads');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
  return v;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function main() {
  const bucket = requireEnv('S3_BUCKET');
  const s3 = new S3Client({
    endpoint: requireEnv('S3_ENDPOINT'),
    region: process.env.S3_REGION || 'auto',
    credentials: { accessKeyId: requireEnv('S3_ACCESS_KEY_ID'), secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY') },
    forcePathStyle: true,
  });
  const prisma = new PrismaClient();

  const docs = await prisma.jobDocument.findMany({
    where: { storedPath: { not: null } },
    select: { id: true, storedPath: true, originalName: true, mimeType: true },
  });
  console.log(`${docs.length} document record(s) with stored binaries. Mode: ${APPLY ? 'APPLY' : 'dry-run'}`);

  let uploaded = 0, skipped = 0, missing = 0, failed = 0;
  for (const doc of docs) {
    const key = doc.storedPath!;
    const localPath = join(UPLOAD_DIR, key);
    if (!existsSync(localPath)) {
      console.warn(`MISSING local file for ${doc.id} (${doc.originalName ?? key}) — nothing to migrate`);
      missing++;
      continue;
    }
    const buffer = await readFile(localPath);

    // Already in the bucket and identical? -> skip (idempotency).
    try {
      const existing = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const remote = await streamToBuffer(existing.Body as Readable);
      if (sha(remote) === sha(buffer)) {
        skipped++;
        continue;
      }
      console.warn(`DIFFERS in bucket: ${key} — will re-upload`);
    } catch {
      /* not in bucket yet */
    }

    if (!APPLY) {
      console.log(`would upload ${key} (${buffer.length} bytes) — ${doc.originalName ?? ''}`);
      uploaded++;
      continue;
    }

    try {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: doc.mimeType ?? undefined }));
      // Verify by re-fetch + hash compare — an unverified migration is no migration.
      const check = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const round = await streamToBuffer(check.Body as Readable);
      if (sha(round) !== sha(buffer)) throw new Error('verification hash mismatch after upload');
      console.log(`uploaded + verified ${key} (${buffer.length} bytes)`);
      uploaded++;
    } catch (e) {
      console.error(`FAILED ${key}: ${(e as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone. uploaded=${uploaded} skipped(identical)=${skipped} missing-local=${missing} failed=${failed}`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
