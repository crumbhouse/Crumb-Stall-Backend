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

process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT EXCEPTION');
  console.error(err);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ UNHANDLED REJECTION');
  console.error(reason);
});

async function bootstrap() {
  try {
    console.log('🚀 Bootstrap started');

    console.log('Creating Nest application...');
    const app = await NestFactory.create(AppModule, {
      rawBody: true,
      logger: new StructuredLogger(),
    });
    console.log('✅ Nest application created');

    app.use(requestContextMiddleware);
    console.log('✅ Request context middleware registered');

    app.setGlobalPrefix(API_PREFIX);
    console.log(`✅ Global prefix set: ${API_PREFIX}`);

    setupCors(app);
    console.log('✅ CORS configured');

    setupValidation(app);
    console.log('✅ Validation configured');

    app.useGlobalFilters(new AllExceptionsFilter());
    console.log('✅ Exception filters configured');

    setupSwagger(app);
    console.log('✅ Swagger configured');

    const port = Number(process.env.PORT) || 3000;

    console.log(`🚀 Starting server on port ${port}...`);

    await app.listen(port, '0.0.0.0');

    console.log(`✅ Application is running on port ${port}`);
  } catch (error) {
    console.error('❌ BOOTSTRAP FAILED');
    console.error(error);
    process.exit(1);
  }
}

bootstrap();