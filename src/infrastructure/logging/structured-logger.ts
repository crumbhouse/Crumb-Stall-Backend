import { LoggerService } from '@nestjs/common';
import { getRequestContext } from './request-context';

type LogLevel = 'debug' | 'error' | 'info' | 'warn';

type LogPayload = {
  level: LogLevel;
  message: string;
  context?: string;
  stack?: string;
  [key: string]: unknown;
};

export class StructuredLogger implements LoggerService {
  log(message: unknown, context?: string) {
    writeLog({ level: 'info', message: stringify(message), context });
  }

  error(message: unknown, stack?: string, context?: string) {
    writeLog({
      level: 'error',
      message: stringify(message),
      context,
      stack: shouldIncludeStack() ? stack : undefined,
    });
  }

  warn(message: unknown, context?: string) {
    writeLog({ level: 'warn', message: stringify(message), context });
  }

  debug(message: unknown, context?: string) {
    if (isDebugEnabled()) {
      writeLog({ level: 'debug', message: stringify(message), context });
    }
  }

  verbose(message: unknown, context?: string) {
    if (isDebugEnabled()) {
      writeLog({ level: 'debug', message: stringify(message), context });
    }
  }
}

export function logInfo(message: string, payload: Record<string, unknown> = {}) {
  writeLog({ level: 'info', message, ...payload });
}

export function logWarn(message: string, payload: Record<string, unknown> = {}) {
  writeLog({ level: 'warn', message, ...payload });
}

export function logError(message: string, payload: Record<string, unknown> = {}) {
  writeLog({ level: 'error', message, ...payload });
}

function writeLog(payload: LogPayload) {
  const context = getRequestContext();
  const normalizedPayload = removeUndefined({
    timestamp: new Date().toISOString(),
    service: 'crumbstall-api',
    requestId: context?.requestId,
    requestMethod: context?.method,
    requestPath: context?.path,
    ...payload,
  });

  if (process.env.LOG_FORMAT === 'pretty') {
    writePretty(normalizedPayload);
    return;
  }

  const line = JSON.stringify(normalizedPayload);

  if (payload.level === 'error') {
    process.stderr.write(`${line}\n`);
    return;
  }

  process.stdout.write(`${line}\n`);
}

function writePretty(payload: Record<string, unknown>) {
  const line = [
    payload.timestamp,
    String(payload.level).toUpperCase().padEnd(5),
    payload.requestId ? `[${payload.requestId}]` : undefined,
    payload.context ? `[${payload.context}]` : undefined,
    payload.message,
  ]
    .filter(Boolean)
    .join(' ');

  if (payload.level === 'error') {
    process.stderr.write(`${line}\n`);
    return;
  }

  process.stdout.write(`${line}\n`);
}

function stringify(message: unknown) {
  return typeof message === 'string' ? message : JSON.stringify(message);
}

function removeUndefined(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
}

function shouldIncludeStack() {
  return process.env.LOG_STACKS !== 'false' && process.env.NODE_ENV !== 'production';
}

function isDebugEnabled() {
  return process.env.LOG_LEVEL === 'debug';
}
