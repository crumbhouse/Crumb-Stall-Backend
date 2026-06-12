import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RecommendationsQuery } from './dto/recommendations-query.dto';

const foodInclude = {
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
} satisfies Prisma.FoodItemInclude;

type FoodRecord = Prisma.FoodItemGetPayload<{ include: typeof foodInclude }>;

@Injectable()
export class RecommendationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findForUser(userId: string | undefined, query: RecommendationsQuery) {
    const [foods, userSignals] = await Promise.all([
      this.prisma.foodItem.findMany({
        where: { isAvailable: true },
        include: foodInclude,
        orderBy: [
          { popularity: 'desc' },
          { ratingAverage: 'desc' },
          { name: 'asc' },
        ],
      }),
      userId ? this.getUserSignals(userId) : null,
    ]);

    const purchasedFoodIds = new Set(userSignals?.purchasedFoodIds ?? []);
    const categoryScores =
      userSignals?.categoryScores ?? new Map<string, number>();
    const tagScores = userSignals?.tagScores ?? new Map<string, number>();

    const rankedFoods = foods
      .map((food) => ({
        food,
        score: this.scoreFood(
          food,
          purchasedFoodIds,
          categoryScores,
          tagScores,
        ),
        reason: getReason(food, categoryScores, tagScores),
      }))
      .sort(
        (first, second) =>
          second.score - first.score ||
          first.food.name.localeCompare(second.food.name),
      )
      .slice(0, query.limit);

    return {
      data: rankedFoods.map((entry) => ({
        ...serializeFoodItem(entry.food),
        recommendationReason: entry.reason,
      })),
      meta: {
        limit: query.limit,
        personalized: Boolean(
          userSignals && (categoryScores.size > 0 || tagScores.size > 0),
        ),
      },
    };
  }

  private async getUserSignals(userId: string) {
    const [orders, favorites] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          items: {
            include: {
              foodItem: {
                include: foodInclude,
              },
            },
          },
        },
      }),
      this.prisma.favorite.findMany({
        where: { userId },
        include: {
          foodItem: {
            include: foodInclude,
          },
        },
      }),
    ]);

    const categoryScores = new Map<string, number>();
    const tagScores = new Map<string, number>();
    const purchasedFoodIds = new Set<string>();

    for (const order of orders) {
      for (const item of order.items) {
        purchasedFoodIds.add(item.foodItemId);
        addScore(categoryScores, item.foodItem.category.slug, 3);
        for (const tag of item.foodItem.tags) {
          addScore(tagScores, tag, 1);
        }
      }
    }

    for (const favorite of favorites) {
      addScore(categoryScores, favorite.foodItem.category.slug, 4);
      for (const tag of favorite.foodItem.tags) {
        addScore(tagScores, tag, 2);
      }
    }

    return {
      categoryScores,
      tagScores,
      purchasedFoodIds: [...purchasedFoodIds],
    };
  }

  private scoreFood(
    food: FoodRecord,
    purchasedFoodIds: Set<string>,
    categoryScores: Map<string, number>,
    tagScores: Map<string, number>,
  ) {
    let score = food.popularity + food.ratingAverage.toNumber() * 10;

    score += categoryScores.get(food.category.slug) ?? 0;

    for (const tag of food.tags) {
      score += tagScores.get(tag) ?? 0;
    }

    if (food.isFeatured) {
      score += 8;
    }

    if (purchasedFoodIds.has(food.id)) {
      score -= 12;
    }

    return score;
  }
}

function addScore(scores: Map<string, number>, key: string, value: number) {
  scores.set(key, (scores.get(key) ?? 0) + value);
}

function getReason(
  food: FoodRecord,
  categoryScores: Map<string, number>,
  tagScores: Map<string, number>,
) {
  const strongestTag = food.tags
    .map((tag) => ({ tag, score: tagScores.get(tag) ?? 0 }))
    .sort((first, second) => second.score - first.score)[0];

  if (strongestTag?.score > 0) {
    return `Because you like ${strongestTag.tag}`;
  }

  if ((categoryScores.get(food.category.slug) ?? 0) > 0) {
    return `More from ${food.category.name}`;
  }

  if (food.isFeatured) {
    return 'Featured by Crumb Stall';
  }

  return 'Popular right now';
}

function serializeFoodItem(item: FoodRecord) {
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
