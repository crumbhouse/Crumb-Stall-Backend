import { BadRequestException } from '@nestjs/common';

export type AnalyticsRangeQuery = {
  days: number;
};

export type AnalyticsLimitQuery = {
  limit: number;
  days: number;
};

export function parseAnalyticsRangeQuery(
  query: Record<string, unknown>,
): AnalyticsRangeQuery {
  return {
    days: parsePositiveInt(query.days, 'days', 7, 1, 90),
  };
}

export function parseAnalyticsLimitQuery(
  query: Record<string, unknown>,
): AnalyticsLimitQuery {
  return {
    limit: parsePositiveInt(query.limit, 'limit', 5, 1, 20),
    days: parsePositiveInt(query.days, 'days', 30, 1, 365),
  };
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
