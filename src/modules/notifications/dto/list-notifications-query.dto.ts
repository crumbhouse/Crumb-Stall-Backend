import { BadRequestException } from '@nestjs/common';

export type ListNotificationsQuery = {
  page: number;
  limit: number;
  unreadOnly: boolean;
};

export function parseListNotificationsQuery(
  query: Record<string, unknown>,
): ListNotificationsQuery {
  return {
    page: parsePositiveInt(query.page, 'page', 1, 1, 500),
    limit: parsePositiveInt(query.limit, 'limit', 20, 1, 50),
    unreadOnly: parseBoolean(query.unreadOnly),
  };
}

function parseBoolean(value: unknown) {
  if (value === undefined || value === '') {
    return false;
  }

  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  throw new BadRequestException('unreadOnly must be true or false');
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
