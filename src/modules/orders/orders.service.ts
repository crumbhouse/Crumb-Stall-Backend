import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuthProvider,
  AdminApprovalStatus,
  NotificationType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { CouponsService } from '../coupons/coupons.service';
import { LiveEventsService } from '../live/live-events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OtpService } from '../otp/otp.service';
import { PaymentsService } from '../payments/payments.service';
import {
  AdminCreateCounterOrderDto,
  ConfirmCheckoutPaymentDto,
  RecoverCheckoutOrderDto,
  StartCheckoutOrderDto,
} from './dto/create-checkout-order.dto';
import { ListOrdersQuery } from './dto/list-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

const ADMIN_STATUS_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PLACED, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PLACED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.CANCELLED],
  [OrderStatus.OTP_VERIFICATION_PENDING]: [OrderStatus.CANCELLED],
};
const ASAP_PICKUP_FEE = 5;

type PreparedCheckoutOrder = {
  orderItems: Array<{
    foodItem: {
      id: string;
      name: string;
      isAvailable: boolean;
      price: Prisma.Decimal;
      discountPrice: Prisma.Decimal | null;
    };
    quantity: number;
    note?: string;
    unitPrice: number;
    totalPrice: number;
  }>;
  coupon: { id: string } | null;
  subtotal: number;
  tax: number;
  discount: number;
  pickupFee: number;
  total: number;
  pickupTime: Date;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly couponsService: CouponsService,
    private readonly liveEventsService: LiveEventsService,
    private readonly notificationsService: NotificationsService,
    private readonly paymentsService: PaymentsService,
    private readonly otpService: OtpService,
  ) {}

  async startCheckoutOrder(
    dto: StartCheckoutOrderDto,
    customerEmail?: string,
    syncSecret?: string,
  ) {
    const customer = await this.resolveCheckoutCustomer(
      customerEmail,
      syncSecret,
    );

    if (dto.checkoutAttemptId) {
      const existingOrder = await this.prisma.order.findFirst({
        where: {
          userId: customer.id,
          checkoutAttemptId: dto.checkoutAttemptId,
        },
        include: {
          items: {
            include: {
              foodItem: {
                select: {
                  slug: true,
                },
              },
            },
          },
          payments: { orderBy: { createdAt: 'desc' } },
        },
      });

      if (existingOrder?.payments[0]?.providerOrderId) {
        return this.serializeCheckoutStart(existingOrder);
      }

      if (
        existingOrder &&
        (existingOrder.status === OrderStatus.PENDING_PAYMENT ||
          existingOrder.status === OrderStatus.CANCELLED)
      ) {
        const pendingOrder =
          existingOrder.status === OrderStatus.CANCELLED
            ? await this.prisma.order.update({
                where: { id: existingOrder.id },
                data: {
                  status: OrderStatus.PENDING_PAYMENT,
                  cancelledAt: null,
                },
                include: {
                  items: true,
                  payments: { orderBy: { createdAt: 'desc' } },
                },
              })
            : existingOrder;

        return this.attachProviderOrderToPendingOrder(pendingOrder);
      }
    }

    const preparedOrder = await this.prepareCheckoutOrder(dto);
    const order = await this.createPendingCheckoutOrder({
      dto,
      customerId: customer.id,
      preparedOrder,
    });

    return this.attachProviderOrderToPendingOrder(order);
  }

  async createCashCheckoutOrder(
    dto: StartCheckoutOrderDto,
    customerEmail?: string,
    syncSecret?: string,
  ) {
    const customer = await this.resolveCheckoutCustomer(
      customerEmail,
      syncSecret,
    );

    if (dto.checkoutAttemptId) {
      const existingOrder = await this.prisma.order.findFirst({
        where: {
          userId: customer.id,
          checkoutAttemptId: dto.checkoutAttemptId,
        },
        include: {
          items: true,
          payments: { orderBy: { createdAt: 'desc' } },
        },
      });

      if (existingOrder) {
        return this.serializeCheckoutOrder(existingOrder);
      }
    }

    const preparedOrder = await this.prepareCheckoutOrder(dto);
    const order = await this.createPendingCheckoutOrder({
      dto,
      customerId: customer.id,
      preparedOrder,
    });

    await this.notificationsService.create({
      userId: order.userId,
      type: NotificationType.ORDER_PLACED,
      title: 'Cash order requested',
      message: `Your order ${order.orderNumber} is waiting for counter payment confirmation.`,
      metadata: {
        orderNumber: order.orderNumber,
        status: order.status,
      },
    });
    this.emitOrderUpdated(order.userId, order.orderNumber, order.status);

    return this.serializeCheckoutOrder(order);
  }

  async createAdminCounterOrder(dto: AdminCreateCounterOrderDto) {
    const customer = await this.resolveOrCreateCounterCustomer(dto.customer);
    const preparedOrder = await this.prepareCheckoutOrder(dto);
    let order = await this.createPendingCheckoutOrder({
      dto,
      customerId: customer.id,
      preparedOrder,
    });

    if (dto.paymentCollected) {
      order = await this.markCounterOrderPlaced(order.id, customer.id);
      await this.sendOrderPlacedNotification(
        order.userId,
        order.orderNumber,
        order.status,
      );
    } else {
      await this.notificationsService.create({
        userId: order.userId,
        type: NotificationType.ORDER_PLACED,
        title: 'Counter order created',
        message: `Your counter order ${order.orderNumber} is waiting for payment confirmation.`,
        metadata: {
          orderNumber: order.orderNumber,
          status: order.status,
          source: 'admin_counter',
        },
      });
    }

    this.emitOrderUpdated(order.userId, order.orderNumber, order.status);

    return this.serializeCheckoutOrder(order);
  }

  async confirmCheckoutPayment(
    dto: ConfirmCheckoutPaymentDto,
    customerEmail?: string,
    syncSecret?: string,
  ) {
    const paymentVerification = this.paymentsService.verifyRazorpayPayment({
      razorpayOrderId: dto.razorpayOrderId,
      razorpayPaymentId: dto.razorpayPaymentId,
      razorpaySignature: dto.razorpaySignature,
    });
    const customer = await this.resolveCheckoutCustomer(
      customerEmail,
      syncSecret,
    );
    const rawPayload =
      paymentVerification.mode === 'live'
        ? await this.findVerifiedCapturedPaymentPayload(
            dto.razorpayOrderId,
            dto.razorpayPaymentId,
          )
        : paymentVerification;

    return this.finalizePaidOrder({
      userId: customer.id,
      orderNumber: dto.orderNumber,
      providerOrderId: dto.razorpayOrderId,
      providerPaymentId: dto.razorpayPaymentId,
      providerSignature: dto.razorpaySignature,
      rawPayload,
    });
  }

  async recoverCheckoutOrder(
    dto: RecoverCheckoutOrderDto,
    customerEmail?: string,
    syncSecret?: string,
  ) {
    const customer = await this.resolveCheckoutCustomer(
      customerEmail,
      syncSecret,
    );
    const recoveredPayment =
      await this.paymentsService.findCapturedPaymentForOrder(
        dto.razorpayOrderId,
      );

    return this.finalizePaidOrder({
      userId: customer.id,
      orderNumber: dto.orderNumber,
      providerOrderId: dto.razorpayOrderId,
      providerPaymentId: recoveredPayment.paymentId,
      rawPayload: recoveredPayment.rawPayload,
    });
  }

  async processRazorpayWebhook(
    rawBody: Buffer | string | undefined,
    signature?: string,
    eventIdHeader?: string,
  ) {
    this.paymentsService.verifyWebhookSignature(rawBody, signature);

    const payload = this.paymentsService.parseWebhookPayload(rawBody);
    const event = this.readJsonString(payload, 'event') ?? 'unknown';
    const paymentEntity = this.readWebhookEntity(payload, 'payment');
    const orderEntity = this.readWebhookEntity(payload, 'order');
    const providerOrderId =
      this.readJsonString(paymentEntity, 'order_id') ??
      this.readJsonString(orderEntity, 'id');
    const providerPaymentId = this.readJsonString(paymentEntity, 'id');
    const eventId = this.resolveWebhookEventId({
      eventIdHeader,
      event,
      providerOrderId,
      providerPaymentId,
      payload,
    });
    const webhookEvent = await this.getOrCreateWebhookEvent({
      eventId,
      event,
      providerOrderId,
      providerPaymentId,
      payload,
    });

    if (webhookEvent.processedAt) {
      return { received: true, duplicate: true };
    }

    if (event === 'payment.captured' || event === 'order.paid') {
      if (!providerOrderId) {
        throw new BadRequestException(
          'Razorpay webhook does not include an order id.',
        );
      }

      const capturedPaymentId =
        providerPaymentId ??
        (
          await this.paymentsService.findCapturedPaymentForOrder(
            providerOrderId,
          )
        ).paymentId;

      await this.finalizePaidOrder({
        providerOrderId,
        providerPaymentId: capturedPaymentId,
        rawPayload: payload,
      });
      await this.markWebhookEventProcessed(
        webhookEvent.id,
        providerOrderId,
        capturedPaymentId,
      );

      return { received: true, processed: true };
    }

    if (event === 'payment.failed') {
      if (providerOrderId) {
        await this.markPendingPaymentFailed(
          providerOrderId,
          providerPaymentId,
          payload,
        );
      }

      await this.markWebhookEventProcessed(
        webhookEvent.id,
        providerOrderId,
        providerPaymentId,
      );

      return { received: true, processed: true };
    }

    await this.markWebhookEventProcessed(
      webhookEvent.id,
      providerOrderId,
      providerPaymentId,
    );

    return { received: true, processed: false };
  }

  private async prepareCheckoutOrder(
    dto: Pick<StartCheckoutOrderDto, 'items' | 'couponCode' | 'pickupSlot'>,
  ): Promise<PreparedCheckoutOrder> {
    const foodItemFilters: Prisma.FoodItemWhereInput[] = dto.items.flatMap(
      (item) => {
        const filters: Prisma.FoodItemWhereInput[] = [];

        if (item.foodItemId) {
          filters.push({ id: item.foodItemId });
        }

        if (item.slug) {
          filters.push({ slug: item.slug });
        }

        return filters;
      },
    );

    const foodItems = await this.prisma.foodItem.findMany({
      where: {
        OR: foodItemFilters,
      },
    });

    const orderItems = dto.items.map((item) => {
      const foodItem = foodItems.find(
        (candidate) =>
          candidate.id === item.foodItemId || candidate.slug === item.slug,
      );

      if (!foodItem) {
        throw new BadRequestException(
          `Food item ${item.slug ?? item.foodItemId} was not found`,
        );
      }

      if (!foodItem.isAvailable) {
        throw new BadRequestException(
          `${foodItem.name} is currently unavailable`,
        );
      }

      const unitPrice =
        foodItem.discountPrice?.toNumber() ?? foodItem.price.toNumber();

      return {
        foodItem,
        quantity: item.quantity,
        note: item.note,
        unitPrice,
        totalPrice: unitPrice * item.quantity,
      };
    });

    const subtotal = orderItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const { coupon, discount } =
      await this.couponsService.resolveCouponForOrder(dto.couponCode, subtotal);
    const taxableAmount = Math.max(subtotal - discount, 0);
    const tax = Math.round(taxableAmount * 0.05);
    const pickupFee = calculatePickupFee(dto.pickupSlot.id);
    const total = taxableAmount + tax + pickupFee;
    const pickupTime = new Date(
      Date.now() + dto.pickupSlot.minutesFromNow * 60_000,
    );

    return {
      orderItems,
      coupon,
      subtotal,
      tax,
      discount,
      pickupFee,
      total,
      pickupTime,
    };
  }

  private async createPendingCheckoutOrder(input: {
    dto: StartCheckoutOrderDto;
    customerId: string;
    preparedOrder: PreparedCheckoutOrder;
  }) {
    const { dto, customerId, preparedOrder } = input;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        return await this.prisma.order.create({
          data: {
            orderNumber: generateOrderNumber(),
            checkoutAttemptId: dto.checkoutAttemptId,
            userId: customerId,
            couponId: preparedOrder.coupon?.id,
            status: OrderStatus.PENDING_PAYMENT,
            pickupTime: preparedOrder.pickupTime,
            subtotalAmount: preparedOrder.subtotal,
            taxAmount: preparedOrder.tax,
            discountAmount: preparedOrder.discount,
            totalAmount: preparedOrder.total,
            estimatedPrepMinutes: dto.pickupSlot.minutesFromNow || 12,
            items: {
              create: preparedOrder.orderItems.map((item) => ({
                foodItemId: item.foodItem.id,
                name: item.foodItem.name,
                note: item.note,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
              })),
            },
          },
          include: {
            items: true,
            payments: { orderBy: { createdAt: 'desc' } },
          },
        });
      } catch (error) {
        if (this.isUniqueConstraintError(error) && attempt < 5) {
          continue;
        }

        throw error;
      }
    }

    throw new InternalServerErrorException('Could not create order number.');
  }

  private async resolveOrCreateCounterCustomer(input: {
    email?: string;
    name?: string;
    phone: string;
  }) {
    const existingUserByPhone = await this.prisma.user.findUnique({
      where: { phone: input.phone },
      select: {
        id: true,
        role: true,
        isSuspended: true,
      },
    });
    const existingUserByEmail = input.email
      ? await this.prisma.user.findUnique({
          where: { email: input.email },
          select: {
            id: true,
            role: true,
            isSuspended: true,
            phone: true,
          },
        })
      : null;

    if (
      existingUserByPhone &&
      existingUserByEmail &&
      existingUserByPhone.id !== existingUserByEmail.id
    ) {
      throw new BadRequestException(
        'Phone number and email belong to different customers.',
      );
    }

    const existingUser = existingUserByPhone ?? existingUserByEmail;

    if (existingUser && existingUser.role !== UserRole.CUSTOMER) {
      throw new BadRequestException(
        'Counter orders can only be created for customer accounts.',
      );
    }

    if (existingUser?.isSuspended) {
      throw new BadRequestException('This customer account is suspended.');
    }

    const customerEmail = input.email ?? createCounterCustomerEmail(input.phone);
    const user = existingUser
      ? await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            ...(input.name ? { name: input.name } : {}),
            ...(input.email ? { email: input.email } : {}),
            phone: input.phone,
            lastActivity: new Date(),
          },
          select: { id: true },
        })
      : await this.prisma.user.create({
          data: {
            email: customerEmail,
            name: input.name,
            phone: input.phone,
            role: UserRole.CUSTOMER,
            provider: AuthProvider.CREDENTIALS,
            adminApprovalStatus: AdminApprovalStatus.APPROVED,
            lastActivity: new Date(),
          },
          select: { id: true },
        });

    await this.prisma.cart.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    return user;
  }

  private async markCounterOrderPlaced(orderId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.PLACED,
          placedAt: new Date(),
          cancelledAt: null,
        },
        include: {
          items: true,
          payments: { orderBy: { createdAt: 'desc' } },
        },
      });

      if (order.couponId) {
        const existingUsage = await tx.couponUsage.findFirst({
          where: {
            orderId: order.id,
            couponId: order.couponId,
          },
          select: { id: true },
        });

        if (!existingUsage) {
          await tx.coupon.update({
            where: { id: order.couponId },
            data: { usedCount: { increment: 1 } },
          });
          await tx.couponUsage.create({
            data: {
              couponId: order.couponId,
              userId,
              orderId: order.id,
            },
          });
        }
      }

      return order;
    });
  }

  private async attachProviderOrderToPendingOrder(order: {
    id: string;
    orderNumber: string;
    userId: string;
    status: OrderStatus;
    pickupTime: Date | null;
    subtotalAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    items: Array<{
      id: string;
      name: string;
      note: string | null;
      quantity: number;
      unitPrice: Prisma.Decimal;
      totalPrice: Prisma.Decimal;
    }>;
    payments: Array<{
      providerOrderId: string | null;
      providerPaymentId: string | null;
      currency: string;
      rawPayload: Prisma.JsonValue | null;
    }>;
  }) {
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        'Checkout can only be started for pending payment orders.',
      );
    }

    const existingPayment = order.payments.find(
      (payment) => payment.providerOrderId,
    );

    if (existingPayment) {
      return this.serializeCheckoutStart(order);
    }

    try {
      const providerOrder = await this.paymentsService.createProviderOrder({
        amount: order.totalAmount.toNumber(),
        currency: 'INR',
        receipt: order.orderNumber,
        notes: {
          source: 'crumbstall-web',
          orderNumber: order.orderNumber,
          userId: order.userId,
        },
      });

      const orderWithPayment = await this.prisma.order.update({
        where: { id: order.id },
        data: {
          cancelledAt: null,
          status: OrderStatus.PENDING_PAYMENT,
          payments: {
            create: {
              status: PaymentStatus.CREATED,
              amount: order.totalAmount,
              currency: providerOrder.currency,
              providerOrderId: providerOrder.orderId,
              rawPayload: providerOrder,
            },
          },
        },
        include: {
          items: true,
          payments: { orderBy: { createdAt: 'desc' } },
        },
      });

      return this.serializeCheckoutStart(orderWithPayment);
    } catch (error) {
      await this.prisma.order
        .update({
          where: { id: order.id },
          data: {
            status: OrderStatus.CANCELLED,
            cancelledAt: new Date(),
          },
        })
        .catch((updateError: unknown) => {
          this.logger.warn(
            `Could not mark failed checkout ${order.orderNumber} as cancelled: ${
              updateError instanceof Error
                ? updateError.message
                : String(updateError)
            }`,
          );
        });

      throw error;
    }
  }

  private async findVerifiedCapturedPaymentPayload(
    razorpayOrderId: string,
    razorpayPaymentId: string,
  ) {
    const capturedPayment =
      await this.paymentsService.findCapturedPaymentForOrder(razorpayOrderId);

    if (capturedPayment.paymentId !== razorpayPaymentId) {
      throw new BadRequestException(
        'Captured payment does not match the checkout payment id.',
      );
    }

    return capturedPayment.rawPayload;
  }

  private async finalizePaidOrder(input: {
    userId?: string;
    orderNumber?: string;
    providerOrderId: string;
    providerPaymentId: string;
    providerSignature?: string;
    rawPayload: Prisma.InputJsonValue;
  }) {
    const payment = await this.prisma.payment.findFirst({
      where: { providerOrderId: input.providerOrderId },
      include: {
        order: {
          include: {
            items: true,
            payments: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(
        'Payment record was not found for this Razorpay order.',
      );
    }

    if (input.userId && payment.order.userId !== input.userId) {
      throw new NotFoundException('Order not found');
    }

    if (input.orderNumber && payment.order.orderNumber !== input.orderNumber) {
      throw new BadRequestException('Payment does not belong to this order.');
    }

    if (
      payment.providerPaymentId &&
      payment.providerPaymentId !== input.providerPaymentId
    ) {
      throw new BadRequestException(
        'Payment was already captured with a different payment id.',
      );
    }

    this.assertCapturedAmountMatches(payment.amount, input.rawPayload);

    const { order, transitionedToPlaced } = await this.prisma.$transaction(
      async (tx) => {
        const currentPayment = await tx.payment.findUnique({
          where: { id: payment.id },
          include: {
            order: {
              include: {
                items: true,
                payments: { orderBy: { createdAt: 'desc' } },
              },
            },
          },
        });

        if (!currentPayment) {
          throw new NotFoundException(
            'Payment record was not found for this Razorpay order.',
          );
        }

        if (
          currentPayment.providerPaymentId &&
          currentPayment.providerPaymentId !== input.providerPaymentId
        ) {
          throw new BadRequestException(
            'Payment was already captured with a different payment id.',
          );
        }

        await tx.payment.update({
          where: { id: currentPayment.id },
          data: {
            status: PaymentStatus.CAPTURED,
            providerPaymentId: input.providerPaymentId,
            providerSignature:
              input.providerSignature ?? currentPayment.providerSignature,
            rawPayload: input.rawPayload,
          },
        });

        const updateResult = await tx.order.updateMany({
          where: {
            id: currentPayment.orderId,
            status: OrderStatus.PENDING_PAYMENT,
          },
          data: {
            status: OrderStatus.PLACED,
            placedAt: new Date(),
            cancelledAt: null,
          },
        });
        const transitionedToPlaced = updateResult.count === 1;

        if (transitionedToPlaced && currentPayment.order.couponId) {
          const existingUsage = await tx.couponUsage.findFirst({
            where: {
              orderId: currentPayment.orderId,
              couponId: currentPayment.order.couponId,
            },
            select: { id: true },
          });

          if (!existingUsage) {
            await tx.coupon.update({
              where: { id: currentPayment.order.couponId },
              data: { usedCount: { increment: 1 } },
            });
            await tx.couponUsage.create({
              data: {
                couponId: currentPayment.order.couponId,
                userId: currentPayment.order.userId,
                orderId: currentPayment.orderId,
              },
            });
          }
        }

        const finalizedOrder = await tx.order.findUniqueOrThrow({
          where: { id: currentPayment.orderId },
          include: {
            items: true,
            payments: { orderBy: { createdAt: 'desc' } },
          },
        });

        return {
          order: finalizedOrder,
          transitionedToPlaced,
        };
      },
    );

    if (transitionedToPlaced) {
      await this.sendOrderPlacedNotification(
        order.userId,
        order.orderNumber,
        order.status,
      );
    }

    this.emitOrderUpdated(order.userId, order.orderNumber, order.status);

    return this.serializeCheckoutOrder(order);
  }

  private async markPendingPaymentFailed(
    providerOrderId: string,
    providerPaymentId: string | undefined,
    rawPayload: Prisma.InputJsonValue,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { providerOrderId },
      include: {
        order: {
          select: { status: true },
        },
      },
    });

    if (!payment || payment.status === PaymentStatus.CAPTURED) {
      return;
    }

    if (payment.order.status !== OrderStatus.PENDING_PAYMENT) {
      return;
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        providerPaymentId: providerPaymentId ?? payment.providerPaymentId,
        rawPayload,
      },
    });
  }

  private async sendOrderPlacedNotification(
    userId: string,
    orderNumber: string,
    status: OrderStatus,
  ) {
    try {
      await this.notificationsService.create({
        userId,
        type: NotificationType.ORDER_PLACED,
        title: 'Order placed',
        message: `Your order ${orderNumber} has been placed.`,
        metadata: {
          orderNumber,
          status,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Order ${orderNumber} was placed, but notification creation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private emitOrderUpdated(
    userId: string,
    orderNumber: string,
    status: OrderStatus,
  ) {
    this.liveEventsService.emitCustomerOrderStatus({
      userId,
      orderNumber,
      status,
    });
    this.liveEventsService.emitAdminOrderUpdated({
      orderNumber,
      status,
    });
  }

  private assertCapturedAmountMatches(
    amount: Prisma.Decimal,
    rawPayload: unknown,
  ) {
    const capturedAmount = this.extractAmountInPaise(rawPayload);

    if (capturedAmount === null) {
      return;
    }

    const expectedAmount = Math.round(amount.toNumber() * 100);

    if (capturedAmount !== expectedAmount) {
      throw new BadRequestException(
        'Captured payment amount does not match the order total.',
      );
    }
  }

  private extractAmountInPaise(rawPayload: unknown): number | null {
    const directAmount = this.readJsonNumber(rawPayload, 'amount');

    if (directAmount !== null) {
      return directAmount;
    }

    const paymentEntity = this.readWebhookEntity(rawPayload, 'payment');

    return this.readJsonNumber(paymentEntity, 'amount');
  }

  private async getOrCreateWebhookEvent(input: {
    eventId: string;
    event: string;
    providerOrderId?: string;
    providerPaymentId?: string;
    payload: Prisma.InputJsonValue;
  }) {
    const existingEvent = await this.prisma.paymentWebhookEvent.findUnique({
      where: { eventId: input.eventId },
    });

    if (existingEvent) {
      return existingEvent;
    }

    try {
      return await this.prisma.paymentWebhookEvent.create({
        data: {
          eventId: input.eventId,
          event: input.event,
          providerOrderId: input.providerOrderId,
          providerPaymentId: input.providerPaymentId,
          rawPayload: input.payload,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        return this.prisma.paymentWebhookEvent.findUniqueOrThrow({
          where: { eventId: input.eventId },
        });
      }

      throw error;
    }
  }

  private async markWebhookEventProcessed(
    id: string,
    providerOrderId?: string,
    providerPaymentId?: string,
  ) {
    await this.prisma.paymentWebhookEvent.update({
      where: { id },
      data: {
        providerOrderId,
        providerPaymentId,
        processedAt: new Date(),
      },
    });
  }

  private resolveWebhookEventId(input: {
    eventIdHeader?: string;
    event: string;
    providerOrderId?: string;
    providerPaymentId?: string;
    payload: Prisma.JsonObject;
  }) {
    if (input.eventIdHeader?.trim()) {
      return input.eventIdHeader.trim();
    }

    const createdAt =
      this.readJsonNumber(input.payload, 'created_at') ?? Date.now();

    return [
      input.event,
      input.providerOrderId ?? 'unknown-order',
      input.providerPaymentId ?? 'unknown-payment',
      createdAt,
    ].join(':');
  }

  private readWebhookEntity(payload: unknown, entity: 'payment' | 'order') {
    const payloadRecord = this.asJsonRecord(payload);
    const innerPayload = this.asJsonRecord(payloadRecord?.payload);
    const entityWrapper = this.asJsonRecord(innerPayload?.[entity]);

    return this.asJsonRecord(entityWrapper?.entity);
  }

  private readJsonString(payload: unknown, key: string) {
    const record = this.asJsonRecord(payload);
    const value = record?.[key];

    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private readJsonNumber(payload: unknown, key: string) {
    const record = this.asJsonRecord(payload);
    const value = record?.[key];

    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private asJsonRecord(payload: unknown): Record<string, unknown> | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    return payload as Record<string, unknown>;
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private serializeCheckoutOrder(order: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    pickupTime: Date | null;
    subtotalAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    payments: Array<{ providerPaymentId: string | null }>;
    items: Array<{
      id: string;
      name: string;
      note: string | null;
      quantity: number;
      unitPrice: Prisma.Decimal;
      totalPrice: Prisma.Decimal;
    }>;
  }) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      pickupTime: order.pickupTime?.toISOString(),
      subtotalAmount: order.subtotalAmount.toNumber(),
      taxAmount: order.taxAmount.toNumber(),
      discountAmount: order.discountAmount.toNumber(),
      pickupFeeAmount: calculateDerivedPickupFee(order),
      totalAmount: order.totalAmount.toNumber(),
      paymentId: order.payments[0]?.providerPaymentId,
      items: order.items.map((item) => ({
        id: item.id,
        name: item.name,
        note: item.note,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toNumber(),
        totalPrice: item.totalPrice.toNumber(),
      })),
    };
  }

  private serializeCheckoutStart(order: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    pickupTime: Date | null;
    subtotalAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    payments: Array<{
      providerOrderId: string | null;
      providerPaymentId: string | null;
      currency: string;
      rawPayload: Prisma.JsonValue | null;
    }>;
    items: Array<{
      id: string;
      name: string;
      note: string | null;
      quantity: number;
      unitPrice: Prisma.Decimal;
      totalPrice: Prisma.Decimal;
    }>;
  }) {
    const payment = order.payments.find((item) => item.providerOrderId);

    if (!payment?.providerOrderId) {
      throw new BadRequestException('Checkout payment order was not created.');
    }

    const rawPayload = this.asJsonRecord(payment.rawPayload);
    const isMockOrder = payment.providerOrderId.startsWith('order_mock_');
    const amount =
      this.readJsonNumber(rawPayload, 'amount') ??
      Math.round(order.totalAmount.toNumber() * 100);
    const keyId =
      this.readJsonString(rawPayload, 'keyId') ??
      process.env.RAZORPAY_KEY_ID ??
      'rzp_test_mock_key';

    return {
      ...this.serializeCheckoutOrder(order),
      razorpay: {
        mode: isMockOrder ? 'mock' : 'live',
        keyId,
        orderId: payment.providerOrderId,
        amount,
        currency: payment.currency,
        receipt: order.orderNumber,
      },
    };
  }

  private async resolveCheckoutCustomer(
    customerEmail?: string,
    syncSecret?: string,
  ) {
    if (!customerEmail) {
      throw new UnauthorizedException('Customer session is required.');
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

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastActivity: new Date() },
    });

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

  async findByOrderNumber(
    orderNumber: string,
    customerEmail?: string,
    syncSecret?: string,
  ) {
    const customer = await this.resolveOrderReader(customerEmail, syncSecret);
    let order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: {
        items: {
          include: {
            foodItem: {
              select: {
                slug: true,
              },
            },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
        coupon: {
          select: {
            code: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (customer && order.userId !== customer.id) {
      throw new NotFoundException('Order not found');
    }

    order =
      (await this.recoverPendingPaymentIfCaptured(order, customer?.id)) ??
      order;

    const pickupOtp = await this.otpService.getDisplayOtpForOrder(order);
    const reviewRating = await this.getOrderReviewRating(
      customer.id,
      order.items.map((item) => item.foodItemId),
    );

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      statusLabel: getOrderStatusLabel(order.status),
      timeline: buildOrderTimeline(order),
      pickupTime: order.pickupTime?.toISOString(),
      placedAt: order.placedAt?.toISOString(),
      completedAt: order.completedAt?.toISOString(),
      subtotalAmount: order.subtotalAmount.toNumber(),
      taxAmount: order.taxAmount.toNumber(),
      discountAmount: order.discountAmount.toNumber(),
      pickupFeeAmount: calculateDerivedPickupFee(order),
      totalAmount: order.totalAmount.toNumber(),
      couponCode: order.coupon?.code ?? null,
      reviewRating,
      pickupOtp,
      payment: getDisplayPayment(order.payments)
        ? {
            status: getDisplayPayment(order.payments)!.status,
            provider: getDisplayPayment(order.payments)!.provider,
            paymentId: getDisplayPayment(order.payments)!.providerPaymentId,
            amount: getDisplayPayment(order.payments)!.amount.toNumber(),
          }
        : null,
      items: order.items.map((item) => ({
        id: item.id,
        foodItemId: item.foodItemId,
        slug: item.foodItem.slug,
        name: item.name,
        note: item.note,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toNumber(),
        totalPrice: item.totalPrice.toNumber(),
      })),
    };
  }

  async findRecentOrders(
    query: ListOrdersQuery,
    customerEmail?: string,
    syncSecret?: string,
  ) {
    const customer = await this.resolveOrderReader(customerEmail, syncSecret);
    const where: Prisma.OrderWhereInput = {
      AND: [
        { userId: customer.id },
        query.status ? { status: query.status } : {},
        query.search
          ? {
              OR: [
                {
                  orderNumber: { contains: query.search, mode: 'insensitive' },
                },
                {
                  items: {
                    some: {
                      name: { contains: query.search, mode: 'insensitive' },
                    },
                  },
                },
              ],
            }
          : {},
      ],
    };

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          items: true,
          payments: {
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    const recoveredOrders = await Promise.all(
      orders.map(async (order) => {
        return (
          (await this.recoverPendingPaymentIfCaptured(order, customer.id)) ??
          order
        );
      }),
    );
    const visibleOrders = query.status
      ? recoveredOrders.filter((order) => order.status === query.status)
      : recoveredOrders;

    return {
      data: visibleOrders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        statusLabel: getOrderStatusLabel(order.status),
        placedAt:
          order.placedAt?.toISOString() ?? order.createdAt.toISOString(),
        pickupTime: order.pickupTime?.toISOString(),
        totalAmount: order.totalAmount.toNumber(),
        itemCount: order.items.reduce<number>((sum, item) => sum + item.quantity, 0),
        itemPreview: order.items.slice(0, 3).map((item) => item.name),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async findAdminOrders(query: ListOrdersQuery) {
    const where: Prisma.OrderWhereInput = {
      AND: [
        query.status ? { status: query.status } : {},
        query.dateFrom || query.dateTo
          ? {
              createdAt: {
                ...(query.dateFrom ? { gte: query.dateFrom } : {}),
                ...(query.dateTo ? { lt: query.dateTo } : {}),
              },
            }
          : {},
        query.minTotal !== undefined || query.maxTotal !== undefined
          ? {
              totalAmount: {
                ...(query.minTotal !== undefined ? { gte: query.minTotal } : {}),
                ...(query.maxTotal !== undefined ? { lte: query.maxTotal } : {}),
              },
            }
          : {},
        query.paymentStatus === 'NONE'
          ? { payments: { none: {} } }
          : query.paymentStatus
            ? { payments: { some: { status: query.paymentStatus } } }
            : {},
        query.paymentProvider === 'CASH'
          ? { payments: { none: {} } }
          : query.paymentProvider
            ? { payments: { some: { provider: query.paymentProvider } } }
            : {},
        query.search
          ? {
              OR: [
                {
                  orderNumber: { contains: query.search, mode: 'insensitive' },
                },
                {
                  user: {
                    email: { contains: query.search, mode: 'insensitive' },
                  },
                },
                {
                  user: {
                    phone: { contains: query.search, mode: 'insensitive' },
                  },
                },
                {
                  user: {
                    name: { contains: query.search, mode: 'insensitive' },
                  },
                },
                {
                  items: {
                    some: {
                      name: { contains: query.search, mode: 'insensitive' },
                    },
                  },
                },
              ],
            }
          : {},
      ],
    };

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          items: true,
          payments: {
            orderBy: { createdAt: 'desc' },
          },
          user: {
            select: {
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    const recoveredOrders = await Promise.all(
      orders.map(async (order) => {
        return (await this.recoverPendingPaymentIfCaptured(order)) ?? order;
      }),
    );
    const visibleOrders = query.status
      ? recoveredOrders.filter((order) => order.status === query.status)
      : recoveredOrders;

    return {
      data: visibleOrders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        statusLabel: getOrderStatusLabel(order.status),
        placedAt:
          order.placedAt?.toISOString() ?? order.createdAt.toISOString(),
        pickupTime: order.pickupTime?.toISOString(),
        totalAmount: order.totalAmount.toNumber(),
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        itemPreview: order.items.slice(0, 3).map((item) => item.name),
        customer: {
          name: order.user.name,
          email: order.user.email,
          phone: order.user.phone,
        },
        allowedStatusUpdates: getAllowedStatusUpdates(order.status),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
      allowedStatusUpdates: [],
    };
  }

  async findAdminOrderByNumber(orderNumber: string) {
    let order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: {
        items: {
          include: {
            foodItem: {
              select: {
                slug: true,
              },
            },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
        coupon: {
          select: {
            code: true,
          },
        },
        user: {
          select: {
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    order = (await this.recoverPendingPaymentIfCaptured(order)) ?? order;

    const pickupOtp = await this.otpService.getDisplayOtpForOrder(order);

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      statusLabel: getOrderStatusLabel(order.status),
      timeline: buildOrderTimeline(order),
      pickupTime: order.pickupTime?.toISOString(),
      placedAt: order.placedAt?.toISOString() ?? order.createdAt.toISOString(),
      completedAt: order.completedAt?.toISOString(),
      cancelledAt: order.cancelledAt?.toISOString(),
      subtotalAmount: order.subtotalAmount.toNumber(),
      taxAmount: order.taxAmount.toNumber(),
      discountAmount: order.discountAmount.toNumber(),
      pickupFeeAmount: calculateDerivedPickupFee(order),
      totalAmount: order.totalAmount.toNumber(),
      couponCode: order.coupon?.code ?? null,
      pickupOtp,
      customer: {
        name: order.user.name,
        email: order.user.email,
        phone: order.user.phone,
      },
      payment: getDisplayPayment(order.payments)
        ? {
            status: getDisplayPayment(order.payments)!.status,
            provider: getDisplayPayment(order.payments)!.provider,
            paymentId: getDisplayPayment(order.payments)!.providerPaymentId,
            providerOrderId: getDisplayPayment(order.payments)!.providerOrderId,
            amount: getDisplayPayment(order.payments)!.amount.toNumber(),
            currency: getDisplayPayment(order.payments)!.currency,
          }
        : null,
      items: order.items.map((item) => ({
        id: item.id,
        name: item.name,
        note: item.note,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toNumber(),
        totalPrice: item.totalPrice.toNumber(),
      })),
      allowedStatusUpdates: getAllowedStatusUpdates(order.status),
    };
  }

  async updateStatus(orderNumber: string, input: UpdateOrderStatusDto) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: {
        id: true,
        status: true,
        couponId: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const allowedStatusUpdates = getAllowedStatusUpdates(order.status);

    if (!allowedStatusUpdates.includes(input.status)) {
      throw new BadRequestException(
        `Cannot move order from ${order.status} to ${input.status}.`,
      );
    }

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const nextOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          status: input.status,
          placedAt:
            input.status === OrderStatus.PLACED && order.status === OrderStatus.PENDING_PAYMENT
              ? new Date()
              : undefined,
          completedAt: input.status === OrderStatus.COMPLETED ? new Date() : null,
          cancelledAt: input.status === OrderStatus.CANCELLED ? new Date() : null,
        },
        include: {
          items: true,
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          coupon: {
            select: {
              code: true,
            },
          },
        },
      });

      if (input.status === OrderStatus.PLACED && order.couponId) {
        const existingUsage = await tx.couponUsage.findFirst({
          where: {
            orderId: order.id,
            couponId: order.couponId,
          },
          select: { id: true },
        });

        if (!existingUsage) {
          await tx.coupon.update({
            where: { id: order.couponId },
            data: { usedCount: { increment: 1 } },
          });
          await tx.couponUsage.create({
            data: {
              couponId: order.couponId,
              userId: nextOrder.userId,
              orderId: order.id,
            },
          });
        }
      }

      return nextOrder;
    });

    if (
      updatedOrder.status === OrderStatus.READY_FOR_PICKUP ||
      updatedOrder.status === OrderStatus.OTP_VERIFICATION_PENDING
    ) {
      await this.otpService.generateForOrderNumber(updatedOrder.orderNumber);
    }

    await this.notificationsService.create({
      userId: updatedOrder.userId,
      type: getNotificationTypeForStatus(updatedOrder.status),
      title: getNotificationTitleForStatus(updatedOrder.status),
      message: getNotificationMessageForStatus(
        updatedOrder.orderNumber,
        updatedOrder.status,
      ),
      metadata: {
        orderNumber: updatedOrder.orderNumber,
        status: updatedOrder.status,
      },
    });

    this.emitOrderUpdated(
      updatedOrder.userId,
      updatedOrder.orderNumber,
      updatedOrder.status,
    );

    return {
      id: updatedOrder.id,
      orderNumber: updatedOrder.orderNumber,
      status: updatedOrder.status,
      statusLabel: getOrderStatusLabel(updatedOrder.status),
      timeline: buildOrderTimeline(updatedOrder),
      pickupTime: updatedOrder.pickupTime?.toISOString(),
      placedAt: updatedOrder.placedAt?.toISOString(),
      completedAt: updatedOrder.completedAt?.toISOString(),
      subtotalAmount: updatedOrder.subtotalAmount.toNumber(),
      taxAmount: updatedOrder.taxAmount.toNumber(),
      discountAmount: updatedOrder.discountAmount.toNumber(),
      pickupFeeAmount: calculateDerivedPickupFee(updatedOrder),
      totalAmount: updatedOrder.totalAmount.toNumber(),
      couponCode: updatedOrder.coupon?.code ?? null,
      payment: getDisplayPayment(updatedOrder.payments)
        ? {
            status: getDisplayPayment(updatedOrder.payments)!.status,
            provider: getDisplayPayment(updatedOrder.payments)!.provider,
            paymentId: getDisplayPayment(updatedOrder.payments)!.providerPaymentId,
            amount: getDisplayPayment(updatedOrder.payments)!.amount.toNumber(),
          }
        : null,
      items: updatedOrder.items.map((item) => ({
        id: item.id,
        name: item.name,
        note: item.note,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toNumber(),
        totalPrice: item.totalPrice.toNumber(),
      })),
    };
  }

  private async recoverPendingPaymentIfCaptured(
    order: {
      id: string;
      orderNumber: string;
      userId: string;
      status: OrderStatus;
      payments: Array<{
        providerOrderId: string | null;
        providerPaymentId: string | null;
      }>;
    },
    userId?: string,
  ) {
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      return null;
    }

    const providerOrderIds = [
      ...new Set(
        order.payments
          .map((item) => item.providerOrderId)
          .filter(
            (providerOrderId): providerOrderId is string =>
              Boolean(providerOrderId) &&
              !providerOrderId!.startsWith('order_mock_'),
          ),
      ),
    ];

    if (providerOrderIds.length === 0) {
      return null;
    }

    for (const providerOrderId of providerOrderIds) {
      try {
        const recoveredPayment =
          await this.paymentsService.findCapturedPaymentForOrder(
            providerOrderId,
            1,
          );

        await this.finalizePaidOrder({
          userId,
          orderNumber: order.orderNumber,
          providerOrderId,
          providerPaymentId: recoveredPayment.paymentId,
          rawPayload: recoveredPayment.rawPayload,
        });

        return this.prisma.order.findUnique({
          where: { id: order.id },
          include: {
            items: {
              include: {
                foodItem: {
                  select: {
                    slug: true,
                  },
                },
              },
            },
            payments: {
              orderBy: { createdAt: 'desc' },
            },
            coupon: {
              select: {
                code: true,
              },
            },
	            user: {
	              select: {
	                name: true,
	                email: true,
	                phone: true,
	              },
	            },
          },
        });
      } catch (error) {
        this.logger.warn(
          `Pending payment recovery skipped for ${order.orderNumber}/${providerOrderId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return null;
  }

  private async getOrderReviewRating(userId: string, foodItemIds: string[]) {
    const uniqueFoodItemIds = Array.from(new Set(foodItemIds));

    if (uniqueFoodItemIds.length === 0) {
      return null;
    }

    const reviews = await this.prisma.review.findMany({
      where: {
        userId,
        foodItemId: { in: uniqueFoodItemIds },
      },
      select: {
        rating: true,
      },
    });

    if (reviews.length === 0) {
      return null;
    }

    const average =
      reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;

    return Math.round(average);
  }

  private async resolveOrderReader(
    customerEmail?: string,
    syncSecret?: string,
  ) {
    if (!customerEmail) {
      throw new UnauthorizedException('Customer session is required.');
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
}

const ORDER_TIMELINE: Array<{
  status: OrderStatus;
  label: string;
  description: string;
}> = [
  {
    status: OrderStatus.PLACED,
    label: 'Order placed',
    description: 'We received your paid pickup order.',
  },
  {
    status: OrderStatus.PREPARING,
    label: 'Preparing',
    description: 'Your food is being prepared.',
  },
  {
    status: OrderStatus.READY_FOR_PICKUP,
    label: 'Ready for pickup',
    description: 'Show your pickup OTP at the counter.',
  },
  {
    status: OrderStatus.COMPLETED,
    label: 'Completed',
    description: 'Order handover completed.',
  },
];

function buildOrderTimeline(order: {
  status: OrderStatus;
  placedAt: Date | null;
  pickupTime: Date | null;
  completedAt: Date | null;
}) {
  const currentIndex = Math.max(
    ORDER_TIMELINE.findIndex((step) => step.status === order.status),
    order.status === OrderStatus.PAID ? 0 : -1,
  );

  return ORDER_TIMELINE.map((step, index) => {
    const isDone = currentIndex >= index;
    const isCurrent = currentIndex === index;
    const timestamp =
      step.status === OrderStatus.PLACED
        ? order.placedAt
        : step.status === OrderStatus.READY_FOR_PICKUP
          ? order.pickupTime
          : step.status === OrderStatus.COMPLETED
            ? order.completedAt
            : null;

    return {
      status: step.status,
      label: step.label,
      description: step.description,
      state: isCurrent ? 'current' : isDone ? 'done' : 'pending',
      timestamp: timestamp?.toISOString() ?? null,
    };
  });
}

function getDisplayPayment<T extends { status: PaymentStatus }>(payments: T[]) {
  return (
    payments.find((payment) => payment.status === PaymentStatus.CAPTURED) ??
    payments[0] ??
    null
  );
}

function getAllowedStatusUpdates(status: OrderStatus) {
  return ADMIN_STATUS_TRANSITIONS[status] ?? [];
}

function calculatePickupFee(pickupSlotId: string) {
  return pickupSlotId === 'asap' ? ASAP_PICKUP_FEE : 0;
}

function calculateDerivedPickupFee(order: {
  subtotalAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
}) {
  const expectedTotalWithoutPickupFee =
    order.subtotalAmount.toNumber() -
    order.discountAmount.toNumber() +
    order.taxAmount.toNumber();
  const fee = order.totalAmount.toNumber() - expectedTotalWithoutPickupFee;

  return Math.max(0, Math.round(fee * 100) / 100);
}

function generateOrderNumber() {
  const timestampPart = Date.now().toString().slice(-6);
  const randomPart = randomInt(10, 100);

  return `CS-${timestampPart}${randomPart}`;
}

function createCounterCustomerEmail(phone: string) {
  const normalizedPhone = phone.replace(/\D/g, '') || phone.replace(/[^a-zA-Z0-9]/g, '');

  return `counter+${normalizedPhone}@crumbstall.local`;
}

function getOrderStatusLabel(status: OrderStatus) {
  if (status === OrderStatus.PAID) {
    return 'Placed';
  }

  if (status === OrderStatus.OTP_VERIFICATION_PENDING) {
    return 'Ready For Pickup';
  }

  return status
    .split('_')
    .map((word) => word[0] + word.slice(1).toLowerCase())
    .join(' ');
}

function getNotificationTypeForStatus(status: OrderStatus) {
  switch (status) {
    case OrderStatus.CONFIRMED:
      return NotificationType.ORDER_CONFIRMED;
    case OrderStatus.PREPARING:
      return NotificationType.ORDER_PREPARING;
    case OrderStatus.READY_FOR_PICKUP:
    case OrderStatus.OTP_VERIFICATION_PENDING:
      return NotificationType.READY_FOR_PICKUP;
    case OrderStatus.COMPLETED:
      return NotificationType.ORDER_COMPLETED;
    default:
      return NotificationType.ORDER_PLACED;
  }
}

function getNotificationTitleForStatus(status: OrderStatus) {
  switch (status) {
    case OrderStatus.CONFIRMED:
      return 'Order confirmed';
    case OrderStatus.PREPARING:
      return 'Order preparing';
    case OrderStatus.READY_FOR_PICKUP:
    case OrderStatus.OTP_VERIFICATION_PENDING:
      return 'Order ready for pickup';
    case OrderStatus.COMPLETED:
      return 'Order completed';
    case OrderStatus.CANCELLED:
      return 'Order cancelled';
    default:
      return 'Order updated';
  }
}

function getNotificationMessageForStatus(
  orderNumber: string,
  status: OrderStatus,
) {
  switch (status) {
    case OrderStatus.CONFIRMED:
      return `Your order ${orderNumber} has been confirmed.`;
    case OrderStatus.PREPARING:
      return `Your order ${orderNumber} is being prepared.`;
    case OrderStatus.READY_FOR_PICKUP:
    case OrderStatus.OTP_VERIFICATION_PENDING:
      return `Your order ${orderNumber} is ready. Show the pickup OTP at the counter.`;
    case OrderStatus.COMPLETED:
      return `Your order ${orderNumber} has been completed.`;
    case OrderStatus.CANCELLED:
      return `Your order ${orderNumber} was cancelled.`;
    default:
      return `Your order ${orderNumber} was updated.`;
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
