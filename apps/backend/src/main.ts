import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as express from 'express';
import { AppModule } from './app.module';
import { ApplicationExceptionFilter } from './common/filters/application-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Raise body size limit to handle bulk bar backfill payloads (up to 500 bars ≈ 150KB)
  app.use(express.json({ limit: '5mb' }));

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new ApplicationExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('FX Trading Engine API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Application is running on port ${port}`);
}

bootstrap();
