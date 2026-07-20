import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Readable } from 'stream';
import { FileStorageService } from '../file-storage.service';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';
import { isValidStorageKey, newStorageKey } from './storage-driver';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

describe('Storage keys', () => {
  it('generates uuid.ext keys with a sanitized extension', () => {
    const key = newStorageKey('Bill of Lading (final).PDF');
    expect(isValidStorageKey(key)).toBe(true);
    expect(key.endsWith('.pdf')).toBe(true);
  });

  it('rejects anything that is not a generated key (path-traversal defence)', () => {
    for (const bad of ['../etc/passwd', 'a/b.pdf', '..\\x', 'plain.pdf', '', 'x'.repeat(60)]) {
      expect(isValidStorageKey(bad)).toBe(false);
    }
  });
});

describe('LocalStorageDriver', () => {
  let root: string;
  let driver: LocalStorageDriver;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'erp-storage-test-'));
    driver = new LocalStorageDriver(root);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('round-trips a buffer: put -> getStream -> identical bytes', async () => {
    const key = newStorageKey('test.pdf');
    const payload = Buffer.from('BL document body %PDF-1.4');
    await driver.put(key, payload);
    const stream = await driver.getStream(key);
    expect(stream).not.toBeNull();
    expect((await streamToBuffer(stream!)).equals(payload)).toBe(true);
  });

  it('materialize returns the real path with a no-op dispose', async () => {
    const key = newStorageKey('doc.pdf');
    await driver.put(key, Buffer.from('x'));
    const local = await driver.materialize(key);
    expect(local?.path).toContain(key);
    await local!.dispose(); // must not delete the underlying object
    expect(await driver.getStream(key)).not.toBeNull();
  });

  it('returns null for a missing or malicious key', async () => {
    expect(await driver.getStream(newStorageKey('missing.pdf'))).toBeNull();
    expect(await driver.getStream('../../etc/passwd')).toBeNull();
    expect(await driver.materialize('..\\..\\secrets')).toBeNull();
  });

  it('remove deletes the object and tolerates a second call', async () => {
    const key = newStorageKey('gone.pdf');
    await driver.put(key, Buffer.from('x'));
    await driver.remove(key);
    expect(await driver.getStream(key)).toBeNull();
    await expect(driver.remove(key)).resolves.toBeUndefined();
  });

  it('rejects put with a non-generated key', async () => {
    await expect(driver.put('../escape.pdf', Buffer.from('x'))).rejects.toThrow(/Invalid storage key/);
  });
});

describe('S3StorageDriver (client mocked)', () => {
  function makeDriver(send: jest.Mock) {
    const driver = new S3StorageDriver({ endpoint: 'https://r2.example', bucket: 'docs', accessKeyId: 'k', secretAccessKey: 's' });
    (driver as unknown as { client: { send: jest.Mock } }).client = { send };
    return driver;
  }

  it('getStream returns null on NoSuchKey instead of throwing', async () => {
    const send = jest.fn(async () => { throw Object.assign(new Error('no'), { name: 'NoSuchKey' }); });
    expect(await makeDriver(send).getStream(newStorageKey('x.pdf'))).toBeNull();
  });

  it('getStream rethrows non-404 errors (credentials, network…)', async () => {
    const send = jest.fn(async () => { throw Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }); });
    await expect(makeDriver(send).getStream(newStorageKey('x.pdf'))).rejects.toThrow('denied');
  });

  it('never sends a malformed key to the bucket', async () => {
    const send = jest.fn();
    const driver = makeDriver(send);
    expect(await driver.getStream('../escape')).toBeNull();
    await driver.remove('../escape');
    await expect(driver.put('../escape', Buffer.from('x'))).rejects.toThrow(/Invalid storage key/);
    expect(send).not.toHaveBeenCalled();
  });

  it('remove swallows delete failures (already-gone objects must not break flows)', async () => {
    const send = jest.fn(async () => { throw new Error('boom'); });
    await expect(makeDriver(send).remove(newStorageKey('x.pdf'))).resolves.toBeUndefined();
  });
});

describe('FileStorageService driver selection', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('defaults to the local driver with no configuration', () => {
    delete process.env.STORAGE_DRIVER;
    expect(new FileStorageService().driverName).toBe('local');
  });

  it('selects the s3 driver when fully configured', () => {
    process.env.STORAGE_DRIVER = 's3';
    process.env.S3_ENDPOINT = 'https://acc.r2.cloudflarestorage.com';
    process.env.S3_BUCKET = 'erp-documents';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    expect(new FileStorageService().driverName).toBe('s3');
  });

  it('falls back to local (and keeps the app booting) when s3 config is incomplete', () => {
    process.env.STORAGE_DRIVER = 's3';
    delete process.env.S3_ENDPOINT;
    expect(new FileStorageService().driverName).toBe('local');
  });
});
