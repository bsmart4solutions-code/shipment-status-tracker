import { plainToInstance } from 'class-transformer';
import { IsEnum, IsIn, IsNotEmpty, IsNumber, IsString, IsOptional, validate } from 'class-validator';

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

  // e.g. https://<account-id>.r2.cloudflarestorage.com
  @IsString()
  @IsOptional()
  S3_ENDPOINT?: string;

  @IsString()
  @IsOptional()
  S3_BUCKET?: string;

  @IsString()
  @IsOptional()
  S3_ACCESS_KEY_ID?: string;

  @IsString()
  @IsOptional()
  S3_SECRET_ACCESS_KEY?: string;

  // R2 expects "auto" (the default); AWS S3 wants a real region.
  @IsString()
  @IsOptional()
  S3_REGION?: string;

  @IsString()
  @IsOptional()
  LOG_LEVEL: string = 'debug';
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
