import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

export type ListOrdersQuery = {
  page: number;
  limit: number;
  status?: OrderStatus;
  search?: string;
};

export function parseListOrdersQuery(
  query: Record<string, unknown>,
): ListOrdersQuery {
  return {
    page: parsePositiveInt(query.page, 'page', 1, 1, 500),
    limit: parsePositiveInt(query.limit, 'limit', 10, 1, 50),
    status: parseOrderStatus(query.status),
    search: parseOptionalString(query.search),
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
