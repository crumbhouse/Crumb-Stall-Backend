import { BadRequestException } from '@nestjs/common';
import { FoodType, Prisma } from '@prisma/client';
import { IsOptional } from 'class-validator';

export type FoodSort =
  | 'popular'
  | 'rating'
  | 'newest'
  | 'price_asc'
  | 'price_desc';

const SORTS = new Set<FoodSort>([
  'popular',
  'rating',
  'newest',
  'price_asc',
  'price_desc',
]);

export type ListFoodQuery = {
  search?: string;
  category?: string;
  type?: FoodType;
  available?: boolean;
  featured?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sort: FoodSort;
  page: number;
  limit: number;
};

export class ListFoodQueryDto {
  [key: string]: unknown;

  @IsOptional()
  search?: string;

  @IsOptional()
  category?: string;

  @IsOptional()
  type?: string;

  @IsOptional()
  available?: string | boolean;

  @IsOptional()
  featured?: string | boolean;

  @IsOptional()
  minPrice?: string | number;

  @IsOptional()
  maxPrice?: string | number;

  @IsOptional()
  sort?: string;

  @IsOptional()
  page?: string | number;

  @IsOptional()
  limit?: string | number;
}

export function parseListFoodQuery(
  query: Record<string, unknown>,
): ListFoodQuery {
  const page = parsePositiveInt(query.page, 'page', 1, 1, 500);
  const limit = parsePositiveInt(query.limit, 'limit', 12, 1, 50);
  const sort = parseSort(query.sort);
  const type = parseFoodType(query.type);
  const minPrice = parseOptionalNumber(query.minPrice, 'minPrice');
  const maxPrice = parseOptionalNumber(query.maxPrice, 'maxPrice');

  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    throw new BadRequestException('minPrice cannot be greater than maxPrice');
  }

  return {
    search: parseOptionalString(query.search),
    category: parseOptionalString(query.category),
    type,
    available: parseOptionalBoolean(query.available),
    featured: parseOptionalBoolean(query.featured),
    minPrice,
    maxPrice,
    sort,
    page,
    limit,
  };
}

export function getFoodOrderBy(
  sort: FoodSort,
): Prisma.FoodItemOrderByWithRelationInput[] {
  switch (sort) {
    case 'rating':
      return [
        { ratingAverage: 'desc' },
        { ratingCount: 'desc' },
        { name: 'asc' },
      ];
    case 'newest':
      return [{ createdAt: 'desc' }];
    case 'price_asc':
      return [
        { discountPrice: { sort: 'asc', nulls: 'last' } },
        { price: 'asc' },
      ];
    case 'price_desc':
      return [
        { discountPrice: { sort: 'desc', nulls: 'last' } },
        { price: 'desc' },
      ];
    case 'popular':
    default:
      return [
        { popularity: 'desc' },
        { ratingAverage: 'desc' },
        { name: 'asc' },
      ];
  }
}

function parseOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseSort(value: unknown): FoodSort {
  if (typeof value !== 'string' || value.trim() === '') {
    return 'popular';
  }

  if (!SORTS.has(value as FoodSort)) {
    throw new BadRequestException(
      `sort must be one of: ${Array.from(SORTS).join(', ')}`,
    );
  }

  return value as FoodSort;
}

function parseFoodType(value: unknown) {
  const type = parseOptionalString(value);

  if (!type) {
    return undefined;
  }

  if (type !== FoodType.VEG && type !== FoodType.NON_VEG) {
    throw new BadRequestException('type must be VEG or NON_VEG');
  }

  return type;
}

function parseOptionalBoolean(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  throw new BadRequestException('Boolean query values must be true or false');
}

function parseOptionalNumber(value: unknown, field: string) {
  if (value === undefined || value === '') {
    return undefined;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new BadRequestException(`${field} must be a positive number`);
  }

  return numberValue;
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
