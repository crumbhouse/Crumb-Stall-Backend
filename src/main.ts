import './config/load-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { API_PREFIX } from './common/constants/app.constants';
import { setupCors } from './config/cors';
import { setupSwagger } from './config/swagger';
import { setupValidation } from './config/validation';
import { AllExceptionsFilter } from './infrastructure/logging/all-exceptions.filter';
import { requestContextMiddleware } from './infrastructure/logging/request-context.middleware';
import { StructuredLogger } from './infrastructure/logging/structured-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: new StructuredLogger(),
  });
  app.use(requestContextMiddleware);
  app.setGlobalPrefix(API_PREFIX);
  setupCors(app);
  setupValidation(app);
  app.useGlobalFilters(new AllExceptionsFilter());
  setupSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
