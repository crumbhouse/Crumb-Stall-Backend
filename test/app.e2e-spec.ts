import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { API_PREFIX } from '../src/common/constants/app.constants';
import { setupValidation } from '../src/config/validation';
import { PrismaService } from '../src/database/prisma.service';
import { AuditService } from '../src/infrastructure/audit/audit.service';
import { CategoriesController } from '../src/modules/categories/categories.controller';
import { CategoriesService } from '../src/modules/categories/categories.service';
import { FoodController } from '../src/modules/food/food.controller';
import { FoodService } from '../src/modules/food/food.service';

type MockPrisma = ReturnType<typeof createMockPrisma>;

const now = new Date('2026-06-07T10:00:00.000Z');

const category = {
  id: 'cat-snacks',
  name: 'Snacks',
  slug: 'snacks',
  description: 'Quick bites',
  imageUrl: null,
  sortOrder: 1,
  isActive: true,
  createdAt: now,
  updatedAt: now,
  _count: {
    foodItems: 2,
  },
};

const foodItem = {
  id: 'food-momo',
  categoryId: category.id,
  name: 'Steamed Momos',
  slug: 'steamed-momos',
  description: 'Soft steamed momos with chutney',
  ingredients: ['momo', 'chutney'],
  price: decimal(120),
  discountPrice: decimal(99),
  imageUrl: '/api/v1/uploads/objects/foods/2026/06/momos.webp',
  tags: ['snacks', 'popular'],
  type: 'VEG',
  ratingAverage: decimal(4.6),
  ratingCount: 18,
  popularity: 99,
  isAvailable: true,
  isFeatured: true,
  createdAt: now,
  updatedAt: now,
  category: {
    id: category.id,
    name: category.name,
    slug: category.slug,
  },
};

describe('Public API integration (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: MockPrisma;

  beforeEach(async () => {
    prisma = createMockPrisma();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CategoriesController, FoodController],
      providers: [
        CategoriesService,
        FoodService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: AuditService,
          useValue: { record: jest.fn() },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(API_PREFIX);
    setupValidation(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists active categories with available food counts', async () => {
    const response = await request(app.getHttpAdapter().getInstance())
      .get('/api/v1/categories')
      .expect(200);

    expect(response.body).toEqual([
      {
        id: 'cat-snacks',
        name: 'Snacks',
        slug: 'snacks',
        description: 'Quick bites',
        imageUrl: null,
        sortOrder: 1,
        foodItemCount: 2,
      },
    ]);
    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: {
            foodItems: {
              where: { isAvailable: true },
            },
          },
        },
      },
    });
  });

  it('lists foods with parsed filters, pagination, and serialized prices', async () => {
    const response = await request(app.getHttpAdapter().getInstance())
      .get('/api/v1/foods')
      .query({
        search: 'momo',
        category: 'snacks',
        available: 'true',
        minPrice: '50',
        maxPrice: '150',
        sort: 'price_asc',
        page: '2',
        limit: '1',
      })
      .expect(200);

    expect(response.body).toEqual({
      data: [
        expect.objectContaining({
          id: 'food-momo',
          name: 'Steamed Momos',
          slug: 'steamed-momos',
          price: 120,
          discountPrice: 99,
          finalPrice: 99,
          ratingAverage: 4.6,
          category: {
            id: 'cat-snacks',
            name: 'Snacks',
            slug: 'snacks',
          },
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        }),
      ],
      meta: {
        page: 2,
        limit: 1,
        total: 1,
        totalPages: 1,
      },
    });
    expect(prisma.foodItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { discountPrice: { sort: 'asc', nulls: 'last' } },
          { price: 'asc' },
        ],
        skip: 1,
        take: 1,
      }),
    );
    expect(prisma.foodItem.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { category: { slug: 'snacks' } },
            { isAvailable: true },
            { price: { gte: 50, lte: 150 } },
          ]),
        }),
      }),
    );
  });

  it('returns a food detail by slug', async () => {
    const response = await request(app.getHttpAdapter().getInstance())
      .get('/api/v1/foods/steamed-momos')
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: 'food-momo',
        slug: 'steamed-momos',
        finalPrice: 99,
      }),
    );
    expect(prisma.foodItem.findUnique).toHaveBeenCalledWith({
      where: { slug: 'steamed-momos' },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  });

  it('returns 404 for an unknown food slug', async () => {
    prisma.foodItem.findUnique.mockResolvedValueOnce(null);

    await request(app.getHttpAdapter().getInstance())
      .get('/api/v1/foods/missing-item')
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe('Food item not found');
      });
  });

  it('rejects admin food listing without a customer session', async () => {
    await request(app.getHttpAdapter().getInstance())
      .get('/api/v1/foods/admin')
      .expect(401);
  });
});

function createMockPrisma() {
  return {
    $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    category: {
      findMany: jest.fn().mockResolvedValue([category]),
    },
    foodItem: {
      findMany: jest.fn().mockResolvedValue([foodItem]),
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue(foodItem),
    },
    user: {
      findUnique: jest.fn(),
    },
  };
}

function decimal(value: number) {
  return {
    toNumber: () => value,
  };
}
