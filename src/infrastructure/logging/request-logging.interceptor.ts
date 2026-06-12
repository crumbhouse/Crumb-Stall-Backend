import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { logInfo } from './structured-logger';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next: () => logRequest(request, response, startedAt),
      }),
    );
  }
}

function logRequest(request: Request, response: Response, startedAt: bigint) {
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  logInfo('HTTP request completed', {
    method: request.method,
    path: request.originalUrl || request.url,
    statusCode: response.statusCode,
    durationMs: Math.round(durationMs * 100) / 100,
    customerEmail: request.header('x-customer-email') ?? undefined,
    userAgent: request.header('user-agent') ?? undefined,
  });
}
