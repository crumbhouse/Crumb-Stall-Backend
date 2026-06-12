import { BadRequestException } from '@nestjs/common';

export type RecommendationsQuery = {
  limit: number;
};

export function parseRecommendationsQuery(
  query: Record<string, unknown>,
): RecommendationsQuery {
  return {
    limit: parsePositiveInt(query.limit, 'limit', 8, 1, 20),
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
