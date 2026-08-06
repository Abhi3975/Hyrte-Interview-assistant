import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WsAdapter } from '@nestjs/platform-ws';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Preserve the raw body so the proctoring webhook can verify HMAC sigs.
    rawBody: true,
    bufferLogs: true,
  });

  // ── Security hardening (OWASP baseline) ──
  app.use(helmet());
  app.enableCors({
    origin: (process.env.WEB_BASE_URL ?? 'http://localhost:3000').split(','),
    credentials: true,
  });

  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  // Native `ws` adapter powers the realtime voice interview gateway.
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  // ── OpenAPI docs at /api/docs ──
  const config = new DocumentBuilder()
    .setTitle('HYRTE API')
    .setDescription('AI interview & Zero-Trust proctoring platform')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, doc);

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`HYRTE API listening on :${port} (docs at /api/docs)`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
