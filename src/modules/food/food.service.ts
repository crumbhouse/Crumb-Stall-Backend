import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateFoodItemDto, UpdateFoodItemDto } from './dto/food-input.dto';
import { getFoodOrderBy, ListFoodQuery } from './dto/list-food-query.dto';

const foodInclude = {
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
} satisfies Prisma.FoodItemInclude;

@Injectable()
export class FoodService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListFoodQuery) {
    const where = this.buildWhere(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.foodItem.findMany({
        where,
        include: foodInclude,
        orderBy: getFoodOrderBy(query.sort),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.foodItem.count({ where }),
    ]);

    return {
      data: items.map((item) => this.serializeFoodItem(item)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async findFeatured(limit = 8) {
    const items = await this.prisma.foodItem.findMany({
      where: {
        isAvailable: true,
        isFeatured: true,
      },
      include: foodInclude,
      orderBy: [{ popularity: 'desc' }, { name: 'asc' }],
      take: limit,
    });

    return items.map((item) => this.serializeFoodItem(item));
  }

  async findPopular(limit = 8) {
    const items = await this.prisma.foodItem.findMany({
      where: { isAvailable: true },
      include: foodInclude,
      orderBy: [
        { popularity: 'desc' },
        { ratingAverage: 'desc' },
        { name: 'asc' },
      ],
      take: limit,
    });

    return items.map((item) => this.serializeFoodItem(item));
  }

  async findBySlug(slug: string) {
    const item = await this.prisma.foodItem.findUnique({
      where: { slug },
      include: foodInclude,
    });

    if (!item) {
      throw new NotFoundException('Food item not found');
    }

    return this.serializeFoodItem(item);
  }

  async findAllForAdmin() {
    const items = await this.prisma.foodItem.findMany({
      include: foodInclude,
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
    });

    return items.map((item) => this.serializeFoodItem(item));
  }

  async create(input: CreateFoodItemDto) {
    await this.assertCategoryExists(input.categoryId);

    try {
      const item = await this.prisma.foodItem.create({
        data: {
          categoryId: input.categoryId,
          name: input.name.trim(),
          slug: normalizeSlug(input.slug ?? input.name),
          description: input.description.trim(),
          ingredients: normalizeList(input.ingredients),
          price: input.price,
          discountPrice: input.discountPrice ?? null,
          imageUrl: normalizeOptionalString(input.imageUrl),
          tags: normalizeList(input.tags),
          type: input.type ?? 'VEG',
          popularity: input.popularity ?? 0,
          isAvailable: input.isAvailable ?? true,
          isFeatured: input.isFeatured ?? false,
        },
        include: foodInclude,
      });

      return this.serializeFoodItem(item);
    } catch (error) {
      this.handleFoodWriteError(error);
    }
  }

  async update(foodItemId: string, input: UpdateFoodItemDto) {
    await this.assertFoodExists(foodItemId);

    if (input.categoryId !== undefined) {
      await this.assertCategoryExists(input.categoryId);
    }

    try {
      const item = await this.prisma.foodItem.update({
        where: { id: foodItemId },
        data: {
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.slug !== undefined
            ? { slug: normalizeSlug(input.slug) }
            : {}),
          ...(input.description !== undefined
            ? { description: input.description.trim() }
            : {}),
          ...(input.ingredients !== undefined
            ? { ingredients: normalizeList(input.ingredients) }
            : {}),
          ...(input.price !== undefined ? { price: input.price } : {}),
          ...(input.discountPrice !== undefined
            ? { discountPrice: input.discountPrice }
            : {}),
          ...(input.imageUrl !== undefined
            ? { imageUrl: normalizeOptionalString(input.imageUrl) }
            : {}),
          ...(input.tags !== undefined ? { tags: normalizeList(input.tags) } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.popularity !== undefined ? { popularity: input.popularity } : {}),
          ...(input.isAvailable !== undefined
            ? { isAvailable: input.isAvailable }
            : {}),
          ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
        },
        include: foodInclude,
      });

      return this.serializeFoodItem(item);
    } catch (error) {
      this.handleFoodWriteError(error);
    }
  }

  async deactivate(foodItemId: string) {
    await this.assertFoodExists(foodItemId);

    const item = await this.prisma.foodItem.update({
      where: { id: foodItemId },
      data: { isAvailable: false },
      include: foodInclude,
    });

    return this.serializeFoodItem(item);
  }

  private buildWhere(query: ListFoodQuery): Prisma.FoodItemWhereInput {
    const and: Prisma.FoodItemWhereInput[] = [];

    if (query.search) {
      and.push({
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { tags: { has: query.search } },
          {
            category: { name: { contains: query.search, mode: 'insensitive' } },
          },
        ],
      });
    }

    if (query.category) {
      and.push({ category: { slug: query.category } });
    }

    if (query.type) {
      and.push({ type: query.type });
    }

    if (query.available !== undefined) {
      and.push({ isAvailable: query.available });
    }

    if (query.featured !== undefined) {
      and.push({ isFeatured: query.featured });
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      and.push({
        price: {
          gte: query.minPrice,
          lte: query.maxPrice,
        },
      });
    }

    return and.length > 0 ? { AND: and } : {};
  }

  private serializeFoodItem(
    item: Prisma.FoodItemGetPayload<{ include: typeof foodInclude }>,
  ) {
    const price = item.price.toNumber();
    const discountPrice = item.discountPrice?.toNumber() ?? null;

    return {
      id: item.id,
      name: item.name,
      slug: item.slug,
      description: item.description,
      ingredients: item.ingredients,
      price,
      discountPrice,
      finalPrice: discountPrice ?? price,
      imageUrl: item.imageUrl,
      tags: item.tags,
      type: item.type,
      ratingAverage: item.ratingAverage.toNumber(),
      ratingCount: item.ratingCount,
      popularity: item.popularity,
      isAvailable: item.isAvailable,
      isFeatured: item.isFeatured,
      category: item.category,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private async assertFoodExists(foodItemId: string) {
    const exists = await this.prisma.foodItem.findUnique({
      where: { id: foodItemId },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('Food item not found');
    }
  }

  private async assertCategoryExists(categoryId: string) {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, isActive: true },
    });

    if (!category || !category.isActive) {
      throw new NotFoundException('Active category not found');
    }
  }

  private handleFoodWriteError(error: unknown): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      throw new ConflictException('Food item slug already exists.');
    }

    throw error;
  }
}

function normalizeSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) {
    throw new ConflictException('Food item slug is required.');
  }

  return slug.slice(0, 140);
}

function normalizeOptionalString(value?: string | null) {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}

function normalizeList(values?: string[]) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}
