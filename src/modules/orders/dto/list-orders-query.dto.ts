import { BadRequestException } from '@nestjs/common';
import { OrderStatus, PaymentProvider, PaymentStatus } from '@prisma/client';

export type ListOrdersQuery = {
  page: number;
  limit: number;
  status?: OrderStatus;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  minTotal?: number;
  maxTotal?: number;
  paymentStatus?: PaymentStatus | 'NONE';
  paymentProvider?: PaymentProvider | 'CASH';
};

export function parseListOrdersQuery(
  query: Record<string, unknown>,
): ListOrdersQuery {
  return {
    page: parsePositiveInt(query.page, 'page', 1, 1, 500),
    limit: parsePositiveInt(query.limit, 'limit', 10, 1, 50),
    status: parseOrderStatus(query.status),
    search: parseOptionalString(query.search),
    dateFrom: parseOptionalDate(query.dateFrom, 'dateFrom'),
    dateTo: parseOptionalDate(query.dateTo, 'dateTo', true),
    minTotal: parseOptionalMoney(query.minTotal, 'minTotal'),
    maxTotal: parseOptionalMoney(query.maxTotal, 'maxTotal'),
    paymentStatus: parsePaymentStatus(query.paymentStatus),
    paymentProvider: parsePaymentProvider(query.paymentProvider),
  };
}

function parseOrderStatus(value: unknown) {
  const status = parseOptionalString(value);

  if (!status) {
    return undefined;
  }

  if (!Object.values(OrderStatus).includes(status as OrderStatus)) {
    throw new BadRequestException(
      `status must be one of: ${Object.values(OrderStatus).join(', ')}`,
    );
  }

  return status as OrderStatus;
}

function parsePaymentStatus(value: unknown) {
  const status = parseOptionalString(value);

  if (!status) {
    return undefined;
  }

  if (status === 'NONE') {
    return status;
  }

  if (!Object.values(PaymentStatus).includes(status as PaymentStatus)) {
    throw new BadRequestException(
      `paymentStatus must be NONE or one of: ${Object.values(PaymentStatus).join(', ')}`,
    );
  }

  return status as PaymentStatus;
}

function parsePaymentProvider(value: unknown) {
  const provider = parseOptionalString(value);

  if (!provider) {
    return undefined;
  }

  if (provider === 'CASH') {
    return provider;
  }

  if (!Object.values(PaymentProvider).includes(provider as PaymentProvider)) {
    throw new BadRequestException(
      `paymentProvider must be CASH or one of: ${Object.values(PaymentProvider).join(', ')}`,
    );
  }

  return provider as PaymentProvider;
}

function parseOptionalDate(value: unknown, field: string, endOfDay = false) {
  const rawDate = parseOptionalString(value);

  if (!rawDate) {
    return undefined;
  }

  const date = new Date(`${rawDate}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} must be a valid date.`);
  }

  if (endOfDay) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return date;
}

function parseOptionalMoney(value: unknown, field: string) {
  if (value === undefined || value === '') {
    return undefined;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new BadRequestException(`${field} must be a positive number.`);
  }

  return numberValue;
}

function parseOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePositiveInt(
  value: unknown,
  field: string,
  fallback: number,
  min: number,
  max: number,
) {
  if (value === undefined || value === '') {
    return fallback;
  }

  const numberValue = Number(value);

  if (
    !Number.isInteger(numberValue) ||
    numberValue < min ||
    numberValue > max
  ) {
    throw new BadRequestException(
      `${field} must be an integer from ${min} to ${max}`,
    );
  }

  return numberValue;
}
