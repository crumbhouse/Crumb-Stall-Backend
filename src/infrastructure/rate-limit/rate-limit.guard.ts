import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { CacheService } from '../cache/cache.service';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 120;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly cacheService: CacheService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    if (isBypassed(request)) {
      return true;
    }

    const windowMs = parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS);
    const maxRequests = parsePositiveInt(process.env.RATE_LIMIT_MAX, DEFAULT_MAX_REQUESTS);
    const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
    const key = `rate-limit:${clientIp(request)}`;
    const result = await this.cacheService.increment(key, ttlSeconds);
    const remaining = Math.max(0, maxRequests - result.count);

    response.setHeader('X-RateLimit-Limit', String(maxRequests));
    response.setHeader('X-RateLimit-Remaining', String(remaining));
    response.setHeader('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000) + result.ttlSeconds));

    if (result.count > maxRequests) {
      response.setHeader('Retry-After', String(result.ttlSeconds));
      throw new HttpException('Too many requests. Please try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }
}

function isBypassed(request: Request) {
  return request.path === '/health' || request.path === '/api/v1/health';
}

function clientIp(request: Request) {
  const forwardedFor = request.header('x-forwarded-for')?.split(',')[0]?.trim();

  return forwardedFor || request.ip || request.socket.remoteAddress || 'unknown';
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
