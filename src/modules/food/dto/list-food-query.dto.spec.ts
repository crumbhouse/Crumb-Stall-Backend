import { BadRequestException } from '@nestjs/common';
import { FoodType } from '@prisma/client';
import { parseListFoodQuery } from './list-food-query.dto';

describe('parseListFoodQuery', () => {
  it('returns catalog defaults', () => {
    expect(parseListFoodQuery({})).toEqual({
      search: undefined,
      category: undefined,
      type: undefined,
      available: undefined,
      featured: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      sort: 'popular',
      page: 1,
      limit: 12,
    });
  });

  it('parses supported filters', () => {
    expect(
      parseListFoodQuery({
        search: 'momos',
        category: 'snacks',
        type: 'VEG',
        available: 'true',
        featured: 'false',
        minPrice: '50',
        maxPrice: '150',
        sort: 'price_asc',
        page: '2',
        limit: '8',
      }),
    ).toMatchObject({
      search: 'momos',
      category: 'snacks',
      type: FoodType.VEG,
      available: true,
      featured: false,
      minPrice: 50,
      maxPrice: 150,
      sort: 'price_asc',
      page: 2,
      limit: 8,
    });
  });

  it('rejects invalid ranges', () => {
    expect(() =>
      parseListFoodQuery({ minPrice: '200', maxPrice: '100' }),
    ).toThrow(BadRequestException);
  });
});
