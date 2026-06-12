import { INestApplication, Logger } from '@nestjs/common';

const logger = new Logger('CorsConfig');

export function setupCors(app: INestApplication) {
  const allowedOrigins = getAllowedOrigins();
  const allowLocalDevOrigins = process.env.NODE_ENV !== 'production';

  if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
    throw new Error('CLIENT_ORIGIN must be configured in production.');
  }

  app.enableCors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (
        allowedOrigins.includes(origin) ||
        (allowLocalDevOrigins && isLocalDevelopmentOrigin(origin))
      ) {
        callback(null, true);
        return;
      }

      logger.warn(`Blocked CORS origin: ${origin}`);
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
  });
}

export function getAllowedOrigins() {
  return (process.env.CLIENT_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => origin.replace(/\/+$/, ''));
}

function isLocalDevelopmentOrigin(origin: string) {
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}
