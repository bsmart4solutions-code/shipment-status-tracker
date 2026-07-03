import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { validateEnv } from './config/env.validation';
import { createAppLogger } from './common/logger/winston.logger';
import helmet from 'helmet';

async function bootstrap() {
  const env = await validateEnv();

  const app = await NestFactory.create(AppModule, { logger: createAppLogger() });

  // Security: Add security headers
  app.use(helmet());

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
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 3600,
  });

  const port = Number(process.env.PORT || 4000);
  const server = await app.listen(port);

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
