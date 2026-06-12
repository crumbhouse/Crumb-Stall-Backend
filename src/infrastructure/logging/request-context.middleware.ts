import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from './request-context';

const requestIdHeader = 'x-request-id';

export function requestContextMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const requestId = getRequestId(request);
  response.setHeader(requestIdHeader, requestId);

  runWithRequestContext(
    {
      requestId,
      method: request.method,
      path: request.originalUrl || request.url,
    },
    next,
  );
}

function getRequestId(request: Request) {
  const headerValue = request.header(requestIdHeader);

  if (headerValue && /^[a-zA-Z0-9._:-]{8,128}$/.test(headerValue)) {
    return headerValue;
  }

  return randomUUID();
}
