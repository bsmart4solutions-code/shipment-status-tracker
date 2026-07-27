import 'reflect-metadata';
import { validateEnv } from './env.validation';

/**
 * H-1 regression (ARCHITECTURE_REVIEW_SPRINT02): production with
 * STORAGE_DRIVER=s3 must fail startup when any S3 credential is missing —
 * silently falling back to the ephemeral local disk would re-create the
 * data-loss condition P0-5 removed. Development keeps zero-config behaviour.
 */
describe('validateEnv — production S3 configuration gate (H-1)', () => {
  const saved = { ...process.env };

  const baseEnv = {
    DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
    JWT_SECRET: 'test-secret-at-least-32-characters!!',
  };

  function setEnv(vars: Record<string, string | undefined>) {
    process.env = { ...saved };
    for (const k of ['NODE_ENV', 'STORAGE_DRIVER', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
      delete process.env[k];
    }
    Object.assign(process.env, baseEnv, vars);
  }

  afterAll(() => { process.env = { ...saved }; });

  it('REJECTS production + s3 with no S3 configuration at all', async () => {
    setEnv({ NODE_ENV: 'production', STORAGE_DRIVER: 's3' });
    await expect(validateEnv()).rejects.toThrow(/S3_ENDPOINT is required in production/);
  });

  it('REJECTS production + s3 when a single credential is missing', async () => {
    setEnv({
      NODE_ENV: 'production', STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', S3_BUCKET: 'erp-documents',
      S3_ACCESS_KEY_ID: 'key', // S3_SECRET_ACCESS_KEY missing
    });
    await expect(validateEnv()).rejects.toThrow(/S3_SECRET_ACCESS_KEY is required in production/);
  });

  it('REJECTS production + s3 when a credential is blank', async () => {
    setEnv({
      NODE_ENV: 'production', STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', S3_BUCKET: '',
      S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret',
    });
    await expect(validateEnv()).rejects.toThrow(/S3_BUCKET is required in production/);
  });

  it('ACCEPTS production + s3 with the full configuration', async () => {
    setEnv({
      NODE_ENV: 'production', STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', S3_BUCKET: 'erp-documents',
      S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret',
    });
    await expect(validateEnv()).resolves.toMatchObject({ STORAGE_DRIVER: 's3' });
  });

  it('ACCEPTS production on the local driver with no S3 configuration', async () => {
    setEnv({ NODE_ENV: 'production', STORAGE_DRIVER: 'local' });
    await expect(validateEnv()).resolves.toMatchObject({ STORAGE_DRIVER: 'local' });
  });

  it('ACCEPTS development + s3 with incomplete configuration (graceful fallback keeps working)', async () => {
    setEnv({ NODE_ENV: 'development', STORAGE_DRIVER: 's3' });
    await expect(validateEnv()).resolves.toMatchObject({ STORAGE_DRIVER: 's3' });
  });

  it('ACCEPTS a default environment with no storage variables at all', async () => {
    setEnv({});
    await expect(validateEnv()).resolves.toMatchObject({ STORAGE_DRIVER: 'local' });
  });
});
