import { Logger } from '@nestjs/common';
import {
  DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { isValidStorageKey, MaterializedFile, StorageDriver } from './storage-driver';

export interface S3DriverConfig {
  endpoint: string; // e.g. https://<account-id>.r2.cloudflarestorage.com
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string; // R2 uses "auto"
}

/**
 * S3-compatible driver — used for Cloudflare R2 in production, and works
 * against MinIO/AWS S3/any S3 API unchanged. Objects are private; every
 * download flows through the authenticated API (RBAC + audit), never a
 * public bucket URL.
 */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3';
  private logger = new Logger(S3StorageDriver.name);
  private client: S3Client;
  private bucket: string;

  constructor(cfg: S3DriverConfig) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region || 'auto',
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // R2 and MinIO both resolve buckets by path, not virtual host.
      forcePathStyle: true,
    });
  }

  async put(key: string, buffer: Buffer): Promise<void> {
    if (!isValidStorageKey(key)) throw new Error(`Invalid storage key: ${key}`);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer }));
  }

  async getStream(key: string): Promise<Readable | null> {
    if (!isValidStorageKey(key)) return null;
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return (res.Body as Readable) ?? null;
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async materialize(key: string): Promise<MaterializedFile | null> {
    const stream = await this.getStream(key);
    if (!stream) return null;
    // Download to a private temp file for tools that need a real path
    // (pdf-parse / OCR); the caller disposes it when done.
    const tmp = join(tmpdir(), `erp-doc-${randomUUID()}`);
    await pipeline(stream, createWriteStream(tmp));
    return {
      path: tmp,
      dispose: async () => {
        await unlink(tmp).catch((e) => this.logger.warn(`Failed to remove temp file ${tmp}: ${e.message}`));
      },
    };
  }

  async remove(key: string): Promise<void> {
    if (!isValidStorageKey(key)) return;
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (e) {
      // Deleting an already-gone object must never break the caller's flow.
      this.logger.warn(`Failed to delete ${key}: ${(e as Error).message}`);
    }
  }
}

function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404;
}
