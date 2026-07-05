import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { extname, join, resolve } from 'path';

/**
 * Local-volume binary storage. Files are written under UPLOAD_DIR with a
 * generated UUID name (the original filename is never used as a path), so
 * there is no path-traversal surface. In production UPLOAD_DIR is mounted to
 * a Docker volume so uploads survive container restarts.
 */
@Injectable()
export class FileStorageService {
  private logger = new Logger(FileStorageService.name);
  private readonly root = resolve(process.env.UPLOAD_DIR || './uploads');

  private async ensureRoot() {
    if (!existsSync(this.root)) await mkdir(this.root, { recursive: true });
  }

  /** Persist a buffer, returning the opaque stored filename to record on the entity. */
  async save(buffer: Buffer, originalName: string): Promise<string> {
    await this.ensureRoot();
    const ext = extname(originalName).slice(0, 10).replace(/[^.a-z0-9]/gi, '');
    const name = `${randomUUID()}${ext}`;
    await writeFile(join(this.root, name), buffer);
    return name;
  }

  /** Absolute path for a stored name, guarded so it can never escape the root. */
  resolvePath(storedName: string): string | null {
    // Reject anything with path separators — stored names are UUIDs only.
    if (!storedName || /[\\/]|\.\./.test(storedName)) return null;
    const full = resolve(this.root, storedName);
    if (!full.startsWith(this.root)) return null;
    return existsSync(full) ? full : null;
  }

  stream(storedName: string) {
    const full = this.resolvePath(storedName);
    return full ? createReadStream(full) : null;
  }

  async remove(storedName: string): Promise<void> {
    const full = this.resolvePath(storedName);
    if (full) await unlink(full).catch((e) => this.logger.warn(`Failed to delete ${storedName}: ${e.message}`));
  }
}
