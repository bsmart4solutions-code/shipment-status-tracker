import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { validateEnv } from './config/env.validation';
import { createAppLogger } from './common/logger/winston.logger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const env = await validateEnv();

  const app = await NestFactory.create(AppModule, { logger: createAppLogger() });

  // Security: Add security headers
  app.use(helmet());

  // Body size: the default 100 KB is too small for the company profile PUT,
  // which carries a base64 logo (auto-optimized client-side to well under a
  // few hundred KB). 5 MB gives comfortable headroom without inviting abuse.
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Validation & transformation
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true, // Reject unknown fields
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    })
  );

  // CORS
  const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map(o => o.trim());

  if (!corsOrigins.length) {
    throw new Error('CORS_ORIGIN environment variable must be set');
  }

  app.enableCors({
    origin: corsOrigins,
    // Pure Bearer-token auth, no cookies anywhere — keep credentials off so
    // a future permissive origin can't be combined with credentialed requests.
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 3600,
  });

  const port = Number(process.env.PORT || 4000);
  // Bind address. Express defaults to every interface, which on a laptop means
  // the API — login endpoint included — is reachable by anything on the same
  // WiFi. Containers and PaaS need the wide bind to route traffic in, so the
  // default is unchanged; a single-machine install sets HOST=127.0.0.1 to keep
  // the API on loopback. CORS does not help here: it is a browser convention,
  // not a network control, and any non-browser client ignores it entirely.
  const host = process.env.HOST || '0.0.0.0';
  const server = await app.listen(port, host);

  // Request timeout
  server.requestTimeout = 30000;

  // Graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`);
    server.close(() => console.log('HTTP server closed'));
    setTimeout(async () => {
      await app.close();
      console.log('App closed');
      process.exit(0);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  new Logger('Bootstrap').log(`Logistics ERP API running on :${port}`);
}

bootstrap().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
