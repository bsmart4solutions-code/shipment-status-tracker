import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.enableCors({ origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(','), credentials: true });
  const port = Number(process.env.PORT || 4000);
  await app.listen(port);
  console.log(`Logistics ERP API running on :${port}`);
}
bootstrap();
