import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/category-input.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const categories = await this.prisma.category.findMany({
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

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      imageUrl: category.imageUrl,
      sortOrder: category.sortOrder,
      foodItemCount: category._count.foodItems,
    }));
  }

  async findAllForAdmin() {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: {
            foodItems: true,
          },
        },
      },
    });

    return categories.map((category) => this.serializeCategory(category));
  }

  async create(input: CreateCategoryDto) {
    try {
      const category = await this.prisma.category.create({
        data: {
          name: input.name.trim(),
          slug: normalizeSlug(input.slug ?? input.name),
          description: normalizeOptionalString(input.description),
          imageUrl: normalizeOptionalString(input.imageUrl),
          sortOrder: input.sortOrder ?? 0,
        },
        include: {
          _count: {
            select: {
              foodItems: true,
            },
          },
        },
      });

      return this.serializeCategory(category);
    } catch (error) {
      this.handleCategoryWriteError(error);
    }
  }

  async update(categoryId: string, input: UpdateCategoryDto) {
    await this.assertCategoryExists(categoryId);

    try {
      const category = await this.prisma.category.update({
        where: { id: categoryId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.slug !== undefined
            ? { slug: normalizeSlug(input.slug) }
            : {}),
          ...(input.description !== undefined
            ? { description: normalizeOptionalString(input.description) }
            : {}),
          ...(input.imageUrl !== undefined
            ? { imageUrl: normalizeOptionalString(input.imageUrl) }
            : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        include: {
          _count: {
            select: {
              foodItems: true,
            },
          },
        },
      });

      return this.serializeCategory(category);
    } catch (error) {
      this.handleCategoryWriteError(error);
    }
  }

  async deactivate(categoryId: string) {
    await this.assertCategoryExists(categoryId);

    const category = await this.prisma.category.update({
      where: { id: categoryId },
      data: { isActive: false },
      include: {
        _count: {
          select: {
            foodItems: true,
          },
        },
      },
    });

    return this.serializeCategory(category);
  }

  private async assertCategoryExists(categoryId: string) {
    const exists = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('Category not found');
    }
  }

  private serializeCategory(category: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    imageUrl: string | null;
    sortOrder: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count: {
      foodItems: number;
    };
  }) {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      imageUrl: category.imageUrl,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      foodItemCount: category._count.foodItems,
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),
    };
  }

  private handleCategoryWriteError(error: unknown): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      throw new ConflictException('Category name or slug already exists.');
    }

    throw error;
  }
}

function normalizeOptionalString(value?: string) {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}

function normalizeSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) {
    throw new ConflictException('Category slug is required.');
  }

  return slug.slice(0, 90);
}
