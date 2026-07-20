import { Injectable, Logger } from '@nestjs/common';
import type { Readable } from 'stream';
import { LocalStorageDriver } from './storage/local-storage.driver';
import { S3StorageDriver } from './storage/s3-storage.driver';
import { MaterializedFile, newStorageKey, StorageDriver } from './storage/storage-driver';

/**
 * Binary storage facade. Business modules (documents, recycle bin) depend on
 * this service only; the actual backend is a pluggable StorageDriver chosen
 * from the environment:
 *
 *   STORAGE_DRIVER=local (default)  — UPLOAD_DIR on the local volume
 *   STORAGE_DRIVER=s3               — any S3-compatible store (Cloudflare R2
 *                                     in production, MinIO in tests) via
 *                                     S3_ENDPOINT / S3_BUCKET /
 *                                     S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
 *
 * Keys are opaque uuid.ext names (see storage-driver.ts); the DB stores the
 * key in JobDocument.storedPath exactly as before, so switching drivers needs
 * no schema or data change.
 */
@Injectable()
export class FileStorageService {
  private logger = new Logger(FileStorageService.name);
  private driver: StorageDriver;

  constructor() {
    this.driver = this.buildDriver();
    this.logger.log(`File storage driver: ${this.driver.name}`);
  }

  private buildDriver(): StorageDriver {
    const requested = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
    if (requested === 's3') {
      const endpoint = process.env.S3_ENDPOINT;
      const bucket = process.env.S3_BUCKET;
      const accessKeyId = process.env.S3_ACCESS_KEY_ID;
      const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
      if (endpoint && bucket && accessKeyId && secretAccessKey) {
        return new S3StorageDriver({ endpoint, bucket, accessKeyId, secretAccessKey, region: process.env.S3_REGION });
      }
      // Fail safe, not silent: boot continues on local so the app stays usable,
      // but the log makes the misconfiguration unmissable.
      this.logger.error('STORAGE_DRIVER=s3 but S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY are incomplete — falling back to local storage');
    }
    return new LocalStorageDriver(process.env.UPLOAD_DIR || './uploads');
  }

  /** Active driver name — surfaced in health/diagnostics and the migration script. */
  get driverName(): string {
    return this.driver.name;
  }

  /** Persist a buffer, returning the opaque stored key to record on the entity. */
  async save(buffer: Buffer, originalName: string): Promise<string> {
    const key = newStorageKey(originalName);
    await this.driver.put(key, buffer);
    return key;
  }

  /** Readable stream of a stored object, or null when missing. */
  async stream(storedName: string): Promise<Readable | null> {
    return this.driver.getStream(storedName);
  }

  /**
   * Local file path for tools that need filesystem access (pdf-parse, OCR).
   * Callers MUST call dispose() when finished — on remote drivers the path is
   * a temp download.
   */
  async materialize(storedName: string): Promise<MaterializedFile | null> {
    return this.driver.materialize(storedName);
  }

  async remove(storedName: string): Promise<void> {
    return this.driver.remove(storedName);
  }
}
