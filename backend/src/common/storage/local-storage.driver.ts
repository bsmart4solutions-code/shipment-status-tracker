import { Logger } from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import type { Readable } from 'stream';
import { isValidStorageKey, MaterializedFile, StorageDriver } from './storage-driver';

/**
 * Local-volume driver (the original behaviour, unchanged semantics). Files
 * live flat under UPLOAD_DIR with generated uuid.ext names. Default driver so
 * development needs zero configuration; in self-hosted production UPLOAD_DIR
 * is mounted to a Docker volume.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private logger = new Logger(LocalStorageDriver.name);
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  private async ensureRoot() {
    if (!existsSync(this.root)) await mkdir(this.root, { recursive: true });
  }

  /** Absolute path for a key, guarded so it can never escape the root. */
  private fullPath(key: string): string | null {
    if (!isValidStorageKey(key)) return null;
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root)) return null;
    return full;
  }

  async put(key: string, buffer: Buffer): Promise<void> {
    await this.ensureRoot();
    const full = this.fullPath(key);
    if (!full) throw new Error(`Invalid storage key: ${key}`);
    await writeFile(full, buffer);
  }

  async getStream(key: string): Promise<Readable | null> {
    const full = this.fullPath(key);
    return full && existsSync(full) ? createReadStream(full) : null;
  }

  async materialize(key: string): Promise<MaterializedFile | null> {
    const full = this.fullPath(key);
    if (!full || !existsSync(full)) return null;
    // The object already IS a local file — nothing to download or clean up.
    return { path: full, dispose: async () => undefined };
  }

  async remove(key: string): Promise<void> {
    const full = this.fullPath(key);
    if (full && existsSync(full)) {
      await unlink(full).catch((e) => this.logger.warn(`Failed to delete ${key}: ${e.message}`));
    }
  }
}
