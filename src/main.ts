import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import * as express from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { corsOrigin } from './common/security';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  const uploadsPath = join(process.cwd(), 'uploads');
  const staticOptions = {
    fallthrough: false,
    immutable: true,
    maxAge: '7d',
    setHeaders: (res: express.Response) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  };
  const serveUploadedFile: express.RequestHandler = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    return express.static(uploadsPath, staticOptions)(req, res, next);
  };
  app.use('/uploads', serveUploadedFile);
  app.use('/api/uploads', serveUploadedFile);
  app.enableCors({ origin: corsOrigin(config), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(config.get<number>('PORT') ?? 3000);
}
bootstrap();
