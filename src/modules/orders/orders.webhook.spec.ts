import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { OrdersService } from './orders.service';

describe('OrdersService Razorpay webhooks', () => {
  const previousWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  afterEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = previousWebhookSecret;
    jest.restoreAllMocks();
  });

  it('finalizes a pending order when Razorpay sends payment.captured', async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret';
    const prisma = createPrismaMock();
    const service = createService(prisma);
    const rawBody = signedPayload({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_live_1',
            order_id: 'order_live_1',
            amount: 21800,
          },
        },
      },
    });

    const result = await service.processRazorpayWebhook(
      rawBody.body,
      rawBody.signature,
      'evt_capture_1',
    );

    expect(result).toEqual({ received: true, processed: true });
    expect(prisma.__tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payment_1' },
        data: expect.objectContaining({
          status: PaymentStatus.CAPTURED,
          providerPaymentId: 'pay_live_1',
        }),
      }),
    );
    expect(prisma.__tx.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order_1', status: OrderStatus.PENDING_PAYMENT },
        data: expect.objectContaining({ status: OrderStatus.PLACED }),
      }),
    );
    expect(prisma.paymentWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'webhook_1' },
        data: expect.objectContaining({
          providerOrderId: 'order_live_1',
          providerPaymentId: 'pay_live_1',
          processedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('does not reprocess duplicate webhook events', async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret';
    const prisma = createPrismaMock({
      webhookEvent: {
        id: 'webhook_1',
        eventId: 'evt_capture_1',
        processedAt: new Date(),
      },
    });
    const service = createService(prisma);
    const rawBody = signedPayload({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_live_1',
            order_id: 'order_live_1',
            amount: 21800,
          },
        },
      },
    });

    const result = await service.processRazorpayWebhook(
      rawBody.body,
      rawBody.signature,
      'evt_capture_1',
    );

    expect(result).toEqual({ received: true, duplicate: true });
    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.__tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('marks pending payments as failed for payment.failed events', async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret';
    const prisma = createPrismaMock();
    const service = createService(prisma);
    const rawBody = signedPayload({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_failed_1',
            order_id: 'order_live_1',
            amount: 21800,
          },
        },
      },
    });

    const result = await service.processRazorpayWebhook(
      rawBody.body,
      rawBody.signature,
      'evt_failed_1',
    );

    expect(result).toEqual({ received: true, processed: true });
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payment_1' },
        data: expect.objectContaining({
          status: PaymentStatus.FAILED,
          providerPaymentId: 'pay_failed_1',
        }),
      }),
    );
    expect(prisma.__tx.order.updateMany).not.toHaveBeenCalled();
  });
});

function createService(prisma: ReturnType<typeof createPrismaMock>) {
  return new OrdersService(
    prisma as never,
    {} as never,
    {
      emitCustomerOrderStatus: jest.fn(),
      emitAdminOrderUpdated: jest.fn(),
    } as never,
    { create: jest.fn() } as never,
    {
      verifyWebhookSignature: new (jest.requireActual('../payments/payments.service').PaymentsService)()
        .verifyWebhookSignature,
      parseWebhookPayload: new (jest.requireActual('../payments/payments.service').PaymentsService)()
        .parseWebhookPayload,
      findCapturedPaymentForOrder: jest.fn(),
    } as never,
    {} as never,
  );
}

function createPrismaMock(options: { webhookEvent?: Record<string, unknown> } = {}) {
  const order = createOrder();
  const payment = createPayment(order);
  const tx = {
    payment: {
      findUnique: jest.fn().mockResolvedValue(payment),
      update: jest.fn().mockResolvedValue({}),
    },
    order: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        ...order,
        status: OrderStatus.PLACED,
        placedAt: new Date('2026-06-07T10:00:00.000Z'),
      }),
    },
    couponUsage: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    coupon: {
      update: jest.fn().mockResolvedValue({}),
    },
  };

  return {
    payment: {
      findFirst: jest.fn().mockResolvedValue(payment),
      update: jest.fn().mockResolvedValue({}),
    },
    paymentWebhookEvent: {
      findUnique: jest.fn().mockResolvedValue(options.webhookEvent ?? null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(options.webhookEvent),
      create: jest.fn().mockResolvedValue({
        id: 'webhook_1',
        processedAt: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    order: {
      updateMany: tx.order.updateMany,
    },
    $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
    ),
    __tx: tx,
  };
}

function createPayment(order: ReturnType<typeof createOrder>) {
  return {
    id: 'payment_1',
    orderId: order.id,
    amount: new Prisma.Decimal(218),
    providerPaymentId: null,
    providerSignature: null,
    order,
  };
}

function createOrder() {
  return {
    id: 'order_1',
    orderNumber: 'CS-WEBHOOK-1',
    userId: 'user_1',
    couponId: null,
    status: OrderStatus.PENDING_PAYMENT,
    pickupTime: null,
    placedAt: null,
    subtotalAmount: new Prisma.Decimal(200),
    taxAmount: new Prisma.Decimal(18),
    discountAmount: new Prisma.Decimal(0),
    totalAmount: new Prisma.Decimal(218),
    items: [
      {
        id: 'item_1',
        name: 'Burger',
        note: null,
        quantity: 1,
        unitPrice: new Prisma.Decimal(200),
        totalPrice: new Prisma.Decimal(200),
      },
    ],
    payments: [{ providerPaymentId: null }],
  };
}

function signedPayload(payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload));
  const signature = createHmac('sha256', 'webhook_secret')
    .update(body)
    .digest('hex');

  return { body, signature };
}
