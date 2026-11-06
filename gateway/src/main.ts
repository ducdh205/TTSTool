import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { appConfig, type AppConfig } from './config/app.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const cfg = app.get<AppConfig>(appConfig.KEY);
  await app.listen(cfg.port);
  Logger.log(
    `Gateway on http://localhost:${cfg.port}  (tts-service: ${cfg.ttsServiceUrl})`,
    'Bootstrap',
  );
}
void bootstrap();
