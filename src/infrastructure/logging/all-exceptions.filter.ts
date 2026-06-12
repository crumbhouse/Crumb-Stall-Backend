import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getRequestContext } from './request-context';
import { logError, logWarn } from './structured-logger';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = getExceptionMessage(exception);
    const requestContext = getRequestContext();
    const payload = {
      method: request.method,
      path: request.originalUrl || request.url,
      statusCode,
      requestId: requestContext?.requestId,
      customerEmail: request.header('x-customer-email') ?? undefined,
      errorName: exception instanceof Error ? exception.name : undefined,
      errorMessage: message,
      stack: shouldIncludeStack(statusCode, exception)
        ? (exception as Error).stack
        : undefined,
    };

    if (statusCode >= 500) {
      logError('HTTP request failed', payload);
    } else {
      logWarn('HTTP request rejected', payload);
    }

    response.status(statusCode).json({
      statusCode,
      message,
      path: request.originalUrl || request.url,
      requestId: requestContext?.requestId,
      timestamp: new Date().toISOString(),
    });
  }
}

function getExceptionMessage(exception: unknown) {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return response;
    }

    if (isResponseObject(response)) {
      const message = response.message;

      if (Array.isArray(message)) {
        return message.join(', ');
      }

      if (typeof message === 'string') {
        return message;
      }
    }

    return exception.message;
  }

  if (exception instanceof Error) {
    return exception.message || 'Internal server error';
  }

  return 'Internal server error';
}

function isResponseObject(value: unknown): value is { message?: unknown } {
  return Boolean(value && typeof value === 'object');
}

function shouldIncludeStack(statusCode: number, exception: unknown) {
  return (
    statusCode >= 500 &&
    exception instanceof Error &&
    process.env.LOG_STACKS !== 'false' &&
    process.env.NODE_ENV !== 'production'
  );
}
