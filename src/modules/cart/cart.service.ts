import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { ReplaceCartDto } from './dto/replace-cart.dto';

const cartInclude = {
  items: {
    include: {
      foodItem: {
        include: {
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  },
} satisfies Prisma.CartInclude;

type CartRecord = Prisma.CartGetPayload<{ include: typeof cartInclude }>;
type CartFoodItem = CartRecord['items'][number]['foodItem'];

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async findForCustomer(customerEmail?: string, syncSecret?: string) {
    const cart = await this.ensureCustomerCart(customerEmail, syncSecret);

    return this.serializeCart(cart);
  }

  async replaceForCustomer(
    input: ReplaceCartDto,
    customerEmail?: string,
    syncSecret?: string,
  ) {
    const cart = await this.ensureCustomerCart(customerEmail, syncSecret);
    const uniqueItems = mergeDuplicateItems(input.items);
    const foodItemIds = uniqueItems.map((item) => item.foodItemId);

    const availableCount = await this.prisma.foodItem.count({
      where: {
        id: { in: foodItemIds },
        isAvailable: true,
      },
    });

    if (availableCount !== foodItemIds.length) {
      throw new NotFoundException('One or more cart items are unavailable.');
    }

    await this.prisma.$transaction([
      this.prisma.cartItem.deleteMany({
        where: { cartId: cart.id },
      }),
      ...uniqueItems.map((item) =>
        this.prisma.cartItem.create({
          data: {
            cartId: cart.id,
            foodItemId: item.foodItemId,
            quantity: item.quantity,
            note: item.note?.trim() || null,
          },
        }),
      ),
    ]);

    const updatedCart = await this.getCartById(cart.id);

    return this.serializeCart(updatedCart);
  }

  async clearForCustomer(customerEmail?: string, syncSecret?: string) {
    const cart = await this.ensureCustomerCart(customerEmail, syncSecret);

    await this.prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    return this.serializeCart(await this.getCartById(cart.id));
  }

  private async ensureCustomerCart(
    customerEmail?: string,
    syncSecret?: string,
  ) {
    this.assertValidSyncSecret(syncSecret);

    if (!customerEmail) {
      throw new UnauthorizedException('Customer session is required.');
    }

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

    const cart = await this.prisma.cart.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
      include: cartInclude,
    });

    return cart;
  }

  private async getCartById(id: string) {
    return this.prisma.cart.findUniqueOrThrow({
      where: { id },
      include: cartInclude,
    });
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

  private serializeCart(cart: CartRecord) {
    return {
      items: cart.items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        note: item.note ?? '',
        item: serializeFoodItem(item.foodItem),
      })),
      updatedAt: cart.updatedAt.toISOString(),
    };
  }
}

function mergeDuplicateItems(items: ReplaceCartDto['items']) {
  const byFoodItemId = new Map<string, ReplaceCartDto['items'][number]>();

  for (const item of items) {
    const existingItem = byFoodItemId.get(item.foodItemId);

    byFoodItemId.set(item.foodItemId, {
      foodItemId: item.foodItemId,
      quantity: Math.min((existingItem?.quantity ?? 0) + item.quantity, 20),
      note: item.note ?? existingItem?.note,
    });
  }

  return [...byFoodItemId.values()];
}

function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}

function serializeFoodItem(item: CartFoodItem) {
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
