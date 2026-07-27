import { plainToInstance } from 'class-transformer';
import { IsEnum, IsIn, IsNotEmpty, IsNumber, IsString, IsOptional, validate, ValidateIf } from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Testing = 'testing',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  PORT: number = 4000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET: string;

  // Must match the name the auth module actually reads (jwt.config.ts).
  // Vercel/ms format: "8h", "30m", "7d"...
  @IsString()
  @IsOptional()
  JWT_EXPIRES_IN: string = '8h';

  @IsString()
  @IsOptional()
  CORS_ORIGIN: string = 'http://localhost:3000';

  @IsString()
  @IsOptional()
  BASE_CURRENCY: string = 'MYR';

  // Directory for uploaded document binaries; mount to a volume in production.
  @IsString()
  @IsOptional()
  UPLOAD_DIR: string = './uploads';

  // Binary storage backend. "local" (default) writes to UPLOAD_DIR; "s3"
  // targets any S3-compatible store (Cloudflare R2 in production) and then
  // requires the four S3_* variables below.
  @IsIn(['local', 's3'])
  @IsOptional()
  STORAGE_DRIVER: string = 'local';

  // H-1 (ARCHITECTURE_REVIEW_SPRINT02): in production with STORAGE_DRIVER=s3
  // the four S3 credentials are REQUIRED — a missing/blank value must fail
  // startup rather than silently fall back to the ephemeral local disk.
  // Outside production (or on the local driver) they stay optional so
  // development needs zero storage configuration.

  // e.g. https://<account-id>.r2.cloudflarestorage.com
  @ValidateIf(requiresS3Config)
  @IsString()
  @IsNotEmpty({ message: 'S3_ENDPOINT is required in production when STORAGE_DRIVER=s3 (refusing to fall back to ephemeral local storage)' })
  S3_ENDPOINT?: string;

  @ValidateIf(requiresS3Config)
  @IsString()
  @IsNotEmpty({ message: 'S3_BUCKET is required in production when STORAGE_DRIVER=s3 (refusing to fall back to ephemeral local storage)' })
  S3_BUCKET?: string;

  @ValidateIf(requiresS3Config)
  @IsString()
  @IsNotEmpty({ message: 'S3_ACCESS_KEY_ID is required in production when STORAGE_DRIVER=s3 (refusing to fall back to ephemeral local storage)' })
  S3_ACCESS_KEY_ID?: string;

  @ValidateIf(requiresS3Config)
  @IsString()
  @IsNotEmpty({ message: 'S3_SECRET_ACCESS_KEY is required in production when STORAGE_DRIVER=s3 (refusing to fall back to ephemeral local storage)' })
  S3_SECRET_ACCESS_KEY?: string;

  // R2 expects "auto" (the default); AWS S3 wants a real region.
  @IsString()
  @IsOptional()
  S3_REGION?: string;

  @IsString()
  @IsOptional()
  LOG_LEVEL: string = 'debug';
}

/** True when the S3 credentials are mandatory: production + s3 driver. */
function requiresS3Config(env: EnvironmentVariables): boolean {
  return env.NODE_ENV === Environment.Production && env.STORAGE_DRIVER === 's3';
}

export async function validateEnv(): Promise<EnvironmentVariables> {
  const config = plainToInstance(EnvironmentVariables, process.env, {
    enableImplicitConversion: true,
  });

  const errors = await validate(config, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment variables:\n${errors
        .map(e => `  ${e.property}: ${Object.values(e.constraints || {}).join(', ')}`)
        .join('\n')}`
    );
  }

  return config;
}
