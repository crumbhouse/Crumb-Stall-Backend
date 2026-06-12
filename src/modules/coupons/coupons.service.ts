import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Coupon, CouponType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon-input.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';

const TAX_RATE = 0.05;

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForAdmin() {
    const coupons = await this.prisma.coupon.findMany({
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }, { code: 'asc' }],
    });

    return coupons.map((coupon) => this.serializeCoupon(coupon));
  }

  async validateCoupon(input: ValidateCouponDto) {
    const normalizedCode = input.code.trim().toUpperCase();

    if (!normalizedCode) {
      throw new BadRequestException('Coupon code is required.');
    }

    const coupon = await this.findActiveCoupon(normalizedCode);
    const discount = this.calculateDiscount(coupon, input.subtotal);
    const taxableAmount = Math.max(input.subtotal - discount, 0);
    const tax = Math.round(taxableAmount * TAX_RATE);

    return {
      coupon: this.serializeCoupon(coupon),
      discount,
      subtotal: input.subtotal,
      taxableAmount,
      tax,
      total: taxableAmount + tax,
      message: `${coupon.code} applied successfully.`,
    };
  }

  async resolveCouponForOrder(code: string | undefined, subtotal: number) {
    if (!code) {
      return { coupon: null, discount: 0 };
    }

    const coupon = await this.findActiveCoupon(code.trim().toUpperCase());

    return {
      coupon,
      discount: this.calculateDiscount(coupon, subtotal),
    };
  }

  async create(input: CreateCouponDto) {
    const dateRange = normalizeRequiredDateRange(input.startsAt, input.endsAt);

    try {
      const coupon = await this.prisma.coupon.create({
        data: {
          code: normalizeCouponCode(input.code),
          type: input.type,
          value: input.value,
          minimumAmount: input.minimumAmount,
          startsAt: dateRange.startsAt,
          endsAt: dateRange.endsAt,
          usageLimit: input.usageLimit ?? null,
          isActive: input.isActive ?? true,
        },
      });

      return this.serializeCoupon(coupon);
    } catch (error) {
      this.handleCouponWriteError(error);
    }
  }

  async update(couponId: string, input: UpdateCouponDto) {
    await this.assertCouponExists(couponId);
    const dateRange =
      input.startsAt !== undefined || input.endsAt !== undefined
        ? normalizeDateRange(input.startsAt, input.endsAt)
        : null;

    try {
      const coupon = await this.prisma.coupon.update({
        where: { id: couponId },
        data: {
          ...(input.code !== undefined
            ? { code: normalizeCouponCode(input.code) }
            : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.minimumAmount !== undefined
            ? { minimumAmount: input.minimumAmount }
            : {}),
          ...(dateRange?.startsAt !== undefined
            ? { startsAt: dateRange.startsAt }
            : {}),
          ...(dateRange?.endsAt !== undefined ? { endsAt: dateRange.endsAt } : {}),
          ...(input.usageLimit !== undefined
            ? { usageLimit: input.usageLimit }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });

      return this.serializeCoupon(coupon);
    } catch (error) {
      this.handleCouponWriteError(error);
    }
  }

  async deactivate(couponId: string) {
    await this.assertCouponExists(couponId);

    const coupon = await this.prisma.coupon.update({
      where: { id: couponId },
      data: { isActive: false },
    });

    return this.serializeCoupon(coupon);
  }

  private async findActiveCoupon(code: string) {
    const now = new Date();
    const coupon = await this.prisma.coupon.findFirst({
      where: {
        code,
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
    });

    if (!coupon) {
      throw new BadRequestException('Coupon code is invalid.');
    }

    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      throw new BadRequestException(
        `${coupon.code} has reached its usage limit.`,
      );
    }

    return coupon;
  }

  private calculateDiscount(coupon: Coupon, subtotal: number) {
    const minimumAmount = coupon.minimumAmount.toNumber();

    if (subtotal < minimumAmount) {
      throw new BadRequestException(
        `Add Rs ${minimumAmount - subtotal} more to use ${coupon.code}.`,
      );
    }

    const value = coupon.value.toNumber();

    if (coupon.type === CouponType.PERCENTAGE) {
      return Math.round((subtotal * value) / 100);
    }

    return Math.min(value, subtotal);
  }

  private serializeCoupon(coupon: Coupon) {
    return {
      id: coupon.id,
      code: coupon.code,
      type: coupon.type,
      value: coupon.value.toNumber(),
      minimumAmount: coupon.minimumAmount.toNumber(),
      startsAt: coupon.startsAt.toISOString(),
      endsAt: coupon.endsAt.toISOString(),
      usageLimit: coupon.usageLimit,
      usedCount: coupon.usedCount,
      isActive: coupon.isActive,
      createdAt: coupon.createdAt.toISOString(),
      updatedAt: coupon.updatedAt.toISOString(),
    };
  }

  private async assertCouponExists(couponId: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id: couponId },
      select: { id: true },
    });

    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
  }

  private handleCouponWriteError(error: unknown): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      throw new ConflictException('Coupon code already exists.');
    }

    throw error;
  }
}

function normalizeCouponCode(code: string) {
  const normalizedCode = code.trim().toUpperCase();

  if (!normalizedCode) {
    throw new BadRequestException('Coupon code is required.');
  }

  return normalizedCode.slice(0, 40);
}

function normalizeRequiredDateRange(startsAt: string, endsAt: string) {
  const dateRange = normalizeDateRange(startsAt, endsAt);

  if (!dateRange.startsAt || !dateRange.endsAt) {
    throw new BadRequestException('Coupon start and end dates are required.');
  }

  return {
    startsAt: dateRange.startsAt,
    endsAt: dateRange.endsAt,
  };
}

function normalizeDateRange(startsAt?: string, endsAt?: string) {
  const normalizedStartsAt = startsAt ? new Date(startsAt) : undefined;
  const normalizedEndsAt = endsAt ? new Date(endsAt) : undefined;

  if (normalizedStartsAt && Number.isNaN(normalizedStartsAt.getTime())) {
    throw new BadRequestException('Coupon start date is invalid.');
  }

  if (normalizedEndsAt && Number.isNaN(normalizedEndsAt.getTime())) {
    throw new BadRequestException('Coupon end date is invalid.');
  }

  if (
    normalizedStartsAt &&
    normalizedEndsAt &&
    normalizedStartsAt.getTime() >= normalizedEndsAt.getTime()
  ) {
    throw new BadRequestException('Coupon end date must be after start date.');
  }

  return {
    startsAt: normalizedStartsAt,
    endsAt: normalizedEndsAt,
  };
}
