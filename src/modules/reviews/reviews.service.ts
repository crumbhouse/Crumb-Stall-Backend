import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { ReviewInput } from './dto/review-input.dto';

const PURCHASED_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.OTP_VERIFICATION_PENDING,
  OrderStatus.COMPLETED,
];

const reviewInclude = {
  user: {
    select: {
      email: true,
      name: true,
      imageUrl: true,
    },
  },
  foodItem: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
} satisfies Prisma.ReviewInclude;

type ReviewRecord = Prisma.ReviewGetPayload<{ include: typeof reviewInclude }>;

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForAdmin() {
    const reviews = await this.prisma.review.findMany({
      include: reviewInclude,
      orderBy: [{ isHidden: 'asc' }, { updatedAt: 'desc' }],
      take: 100,
    });

    return reviews.map(serializeReview);
  }

  async findForFood(slug: string, customerEmail?: string, syncSecret?: string) {
    const [user, foodItem] = await Promise.all([
      this.resolveOptionalUser(customerEmail, syncSecret),
      this.prisma.foodItem.findUnique({
        where: { slug },
        select: {
          id: true,
          name: true,
          ratingAverage: true,
          ratingCount: true,
        },
      }),
    ]);

    if (!foodItem) {
      throw new NotFoundException('Food item not found');
    }

    const [reviews, canReview, myReview] = await Promise.all([
      this.prisma.review.findMany({
        where: {
          foodItemId: foodItem.id,
          isHidden: false,
        },
        include: reviewInclude,
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      user ? this.hasPurchasedFood(user.id, foodItem.id) : false,
      user
        ? this.prisma.review.findUnique({
            where: {
              userId_foodItemId: {
                userId: user.id,
                foodItemId: foodItem.id,
              },
            },
            include: reviewInclude,
          })
        : null,
    ]);

    return {
      summary: {
        ratingAverage: foodItem.ratingAverage.toNumber(),
        ratingCount: foodItem.ratingCount,
      },
      canReview,
      myReview: myReview ? serializeReview(myReview) : null,
      data: reviews.map(serializeReview),
    };
  }

  async rateOrder(orderNumber: string, input: ReviewInput, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        orderNumber,
        userId,
      },
      select: {
        orderNumber: true,
        status: true,
        items: {
          select: {
            foodItemId: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!PURCHASED_STATUSES.includes(order.status)) {
      throw new ForbiddenException('Only paid orders can be rated');
    }

    const foodItemIds = Array.from(
      new Set(order.items.map((item) => item.foodItemId)),
    );

    if (foodItemIds.length === 0) {
      throw new NotFoundException('No order items found');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const foodItemId of foodItemIds) {
        await tx.review.upsert({
          where: {
            userId_foodItemId: {
              userId,
              foodItemId,
            },
          },
          update: {
            rating: input.rating,
            comment: null,
            isHidden: false,
          },
          create: {
            userId,
            foodItemId,
            rating: input.rating,
            comment: null,
          },
        });

        await updateFoodRatingAggregate(tx, foodItemId);
      }
    });

    return {
      orderNumber: order.orderNumber,
      rating: input.rating,
      reviewedItemCount: foodItemIds.length,
    };
  }

  async moderateReview(reviewId: string, isHidden: boolean) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, foodItemId: true },
    });

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    const updatedReview = await this.prisma.$transaction(async (tx) => {
      const moderatedReview = await tx.review.update({
        where: { id: reviewId },
        data: { isHidden },
        include: reviewInclude,
      });

      await updateFoodRatingAggregate(tx, moderatedReview.foodItemId);

      return moderatedReview;
    });

    return serializeReview(updatedReview);
  }

  private hasPurchasedFood(userId: string, foodItemId: string) {
    return this.prisma.order
      .findFirst({
        where: {
          userId,
          status: { in: PURCHASED_STATUSES },
          items: {
            some: { foodItemId },
          },
        },
        select: { id: true },
      })
      .then(Boolean);
  }

  private async resolveOptionalUser(
    customerEmail?: string,
    syncSecret?: string,
  ) {
    if (!customerEmail) {
      return null;
    }

    this.assertValidSyncSecret(syncSecret);

    const user = await this.prisma.user.findUnique({
      where: { email: customerEmail },
      select: {
        id: true,
        isSuspended: true,
      },
    });

    if (!user || user.isSuspended) {
      throw new UnauthorizedException('Customer session is invalid.');
    }

    return user;
  }

  private assertValidSyncSecret(syncSecret?: string) {
    const expectedSecret = process.env.AUTH_SYNC_SECRET;

    if (!expectedSecret) {
      if (process.env.NODE_ENV === 'production') {
        throw new InternalServerErrorException(
          'AUTH_SYNC_SECRET is not configured.',
        );
      }

      return;
    }

    if (!syncSecret || !safeEqual(syncSecret, expectedSecret)) {
      throw new UnauthorizedException('Invalid auth sync secret.');
    }
  }
}

function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}

function serializeReview(review: ReviewRecord) {
  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    imageUrls: review.imageUrls,
    isHidden: review.isHidden,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
    user: {
      name: review.user.name ?? 'Crumb Stall customer',
      email: review.user.email,
      imageUrl: review.user.imageUrl,
    },
    foodItem: {
      id: review.foodItem.id,
      name: review.foodItem.name,
      slug: review.foodItem.slug,
    },
  };
}

async function updateFoodRatingAggregate(
  tx: Prisma.TransactionClient,
  foodItemId: string,
) {
  const aggregate = await tx.review.aggregate({
    where: {
      foodItemId,
      isHidden: false,
    },
    _avg: { rating: true },
    _count: { rating: true },
  });

  await tx.foodItem.update({
    where: { id: foodItemId },
    data: {
      ratingAverage: new Prisma.Decimal(
        (aggregate._avg.rating ?? 0).toFixed(2),
      ),
      ratingCount: aggregate._count.rating,
    },
  });
}
