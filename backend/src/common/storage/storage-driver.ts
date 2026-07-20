import { randomUUID } from 'crypto';
import { extname } from 'path';
import type { Readable } from 'stream';

/**
 * Pluggable binary-storage contract. Business logic (documents, recycle bin)
 * talks only to FileStorageService, which delegates to one of these drivers —
 * adding a future provider (GCS, Azure Blob…) means one new driver class and
 * zero changes elsewhere.
 *
 * Keys are opaque `uuid.ext` names generated here (never a user-supplied
 * filename), so no driver ever sees a path-traversal surface.
 */
export interface StorageDriver {
  /** Driver identifier as configured (e.g. "local", "s3"). */
  readonly name: string;
  /** Persist a buffer under the given key. */
  put(key: string, buffer: Buffer): Promise<void>;
  /** Readable stream of the object, or null when it does not exist. */
  getStream(key: string): Promise<Readable | null>;
  /**
   * Materialize the object as a local file for tools that need filesystem
   * access (pdf-parse, OCR). The local driver returns its real path with a
   * no-op dispose; remote drivers download to a temp file that dispose()
   * removes. Null when the object does not exist.
   */
  materialize(key: string): Promise<MaterializedFile | null>;
  /** Delete the object; must not throw when the object is already gone. */
  remove(key: string): Promise<void>;
}

export interface MaterializedFile {
  path: string;
  dispose(): Promise<void>;
}

/** uuid + short sanitized extension — the only key shape ever stored. */
export function newStorageKey(originalName: string): string {
  const ext = extname(originalName).slice(0, 10).replace(/[^.a-z0-9]/gi, '').toLowerCase();
  return `${randomUUID()}${ext}`;
}

/** True only for keys this system generates (defence-in-depth for drivers). */
export function isValidStorageKey(key: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,9})?$/i.test(key ?? '');
}
