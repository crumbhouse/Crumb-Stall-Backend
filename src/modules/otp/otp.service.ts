import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, OrderStatus } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
} from '../../common/constants/app.constants';
import { PrismaService } from '../../database/prisma.service';
import { LiveEventsService } from '../live/live-events.service';
import { NotificationsService } from '../notifications/notifications.service';

type OtpOrder = {
  id: string;
  status: OrderStatus;
};

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly liveEventsService: LiveEventsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async generateForOrderNumber(
    orderNumber: string,
    options: { forceRefresh?: boolean } = {},
  ) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: {
        id: true,
        userId: true,
        status: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (
      order.status !== OrderStatus.READY_FOR_PICKUP &&
      order.status !== OrderStatus.OTP_VERIFICATION_PENDING
    ) {
      throw new BadRequestException(
        'OTP can only be generated for ready pickup orders',
      );
    }

    const otp = await this.getDisplayOtpForOrder(order, {
      forceRefresh: options.forceRefresh,
    });

    if (otp) {
      await this.notificationsService.create({
        userId: order.userId,
        type: NotificationType.OTP_GENERATED,
        title: 'Pickup OTP generated',
        message: `Your pickup OTP for order ${orderNumber} is ${otp.code}.`,
        metadata: {
          orderNumber,
          status: order.status,
          expiresAt: otp.expiresAt,
        },
      });

      this.liveEventsService.emitCustomerOrderStatus({
        userId: order.userId,
        orderNumber,
        status: order.status,
      });
      this.liveEventsService.emitAdminOrderUpdated({
        orderNumber,
        status: order.status,
      });
    }

    return otp;
  }

  async getDisplayOtpForOrder(
    order: OtpOrder,
    options: { forceRefresh?: boolean } = {},
  ) {
    if (
      order.status !== OrderStatus.READY_FOR_PICKUP &&
      order.status !== OrderStatus.OTP_VERIFICATION_PENDING
    ) {
      return null;
    }

    const now = new Date();
    const existingOtp = await this.prisma.orderOtp.findUnique({
      where: { orderId: order.id },
    });

    if (
      !options.forceRefresh &&
      existingOtp &&
      !existingOtp.verifiedAt &&
      existingOtp.expiresAt > now
    ) {
      return {
        code: deriveOtp(order.id, existingOtp.expiresAt),
        expiresAt: existingOtp.expiresAt.toISOString(),
        attemptCount: existingOtp.attemptCount,
      };
    }

    const currentCode =
      existingOtp && !existingOtp.verifiedAt
        ? deriveOtp(order.id, existingOtp.expiresAt)
        : null;
    let expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60_000);
    let code = deriveOtp(order.id, expiresAt);

    if (options.forceRefresh && currentCode) {
      let offsetMs = 1;

      while (code === currentCode) {
        expiresAt = new Date(
          now.getTime() + OTP_EXPIRY_MINUTES * 60_000 + offsetMs,
        );
        code = deriveOtp(order.id, expiresAt);
        offsetMs += 1;
      }
    }

    const otp = await this.prisma.orderOtp.upsert({
      where: { orderId: order.id },
      update: {
        otpHash: hashOtp(order.id, code),
        expiresAt,
        verifiedAt: null,
        attemptCount: 0,
      },
      create: {
        orderId: order.id,
        otpHash: hashOtp(order.id, code),
        expiresAt,
      },
    });

    return {
      code,
      expiresAt: otp.expiresAt.toISOString(),
      attemptCount: otp.attemptCount,
    };
  }

  async verifyForOrderNumber(orderNumber: string, otp: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: {
        id: true,
        userId: true,
        status: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (
      order.status !== OrderStatus.READY_FOR_PICKUP &&
      order.status !== OrderStatus.OTP_VERIFICATION_PENDING
    ) {
      throw new BadRequestException('Order is not ready for OTP verification');
    }

    const orderOtp = await this.prisma.orderOtp.findUnique({
      where: { orderId: order.id },
    });

    if (!orderOtp || orderOtp.verifiedAt) {
      throw new BadRequestException(
        'No active OTP is available for this order',
      );
    }

    if (orderOtp.expiresAt <= new Date()) {
      await this.generateForOrderNumber(orderNumber, { forceRefresh: true });

      throw new BadRequestException(
        'OTP expired. A new pickup OTP has been generated and sent to the customer.',
      );
    }

    if (orderOtp.attemptCount >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException(
        'OTP attempt limit reached. Generate a new code.',
      );
    }

    const isMatch = safeEqual(hashOtp(order.id, otp), orderOtp.otpHash);

    if (!isMatch) {
      const updatedOtp = await this.prisma.orderOtp.update({
        where: { id: orderOtp.id },
        data: { attemptCount: { increment: 1 } },
      });

      throw new BadRequestException(
        `Invalid OTP. ${Math.max(OTP_MAX_ATTEMPTS - updatedOtp.attemptCount, 0)} attempts remaining.`,
      );
    }

    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.orderOtp.update({
        where: { id: orderOtp.id },
        data: {
          verifiedAt: now,
          attemptCount: { increment: 1 },
        },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.COMPLETED,
          completedAt: now,
        },
      }),
    ]);

    await this.notificationsService.create({
      userId: order.userId,
      type: NotificationType.ORDER_COMPLETED,
      title: 'Order completed',
      message: `Your order ${orderNumber} has been picked up successfully.`,
      metadata: {
        orderNumber,
        verifiedAt: now.toISOString(),
      },
    });

    this.liveEventsService.emitCustomerOrderStatus({
      userId: order.userId,
      orderNumber,
      status: OrderStatus.COMPLETED,
    });
    this.liveEventsService.emitAdminOrderUpdated({
      orderNumber,
      status: OrderStatus.COMPLETED,
    });

    return {
      verified: true,
      orderNumber,
      status: OrderStatus.COMPLETED,
      verifiedAt: now.toISOString(),
    };
  }
}

function deriveOtp(orderId: string, expiresAt: Date) {
  const secret = getOtpSecret();
  const digest = createHmac('sha256', secret)
    .update(`${orderId}:${expiresAt.toISOString()}`)
    .digest('hex');
  const value = Number.parseInt(digest.slice(0, 8), 16) % 1_000_000;

  return value.toString().padStart(6, '0');
}

function hashOtp(orderId: string, otp: string) {
  return createHmac('sha256', getOtpSecret())
    .update(`${orderId}:${otp}`)
    .digest('hex');
}

function getOtpSecret() {
  return (
    process.env.OTP_SECRET ??
    process.env.JWT_SECRET ??
    'crumbstall-dev-otp-secret'
  );
}

function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}
