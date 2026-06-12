import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DEFAULT_CURRENCY } from '../../common/constants/app.constants';
import { CreateRazorpayOrderDto } from './dto/create-razorpay-order.dto';
import { VerifyRazorpayPaymentDto } from './dto/verify-razorpay-payment.dto';

type RazorpayOrderResponse = {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
};

type RazorpayPaymentResponse = {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  order_id: string;
  captured: boolean;
};

@Injectable()
export class PaymentsService {
  async createRazorpayOrder(dto: CreateRazorpayOrderDto) {
    return this.createProviderOrder({
      amount: dto.amount,
      currency: dto.currency,
      receipt: dto.receipt,
      notes: dto.notes,
    });
  }

  async createProviderOrder(input: {
    amount: number;
    currency?: string;
    receipt?: string;
    notes?: Record<string, string>;
  }) {
    const amountInPaise = Math.round(input.amount * 100);
    const currency = input.currency ?? DEFAULT_CURRENCY;
    const receipt = input.receipt ?? `CS-${Date.now()}`;
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return {
        mode: 'mock' as const,
        keyId: 'rzp_test_mock_key',
        orderId: `order_mock_${Date.now()}`,
        amount: amountInPaise,
        currency,
        receipt,
      };
    }

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency,
        receipt,
        notes: input.notes,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException({
        message: 'Failed to create Razorpay order',
        details: errorBody,
      });
    }

    const order = (await response.json()) as RazorpayOrderResponse;

    return {
      mode: 'live' as const,
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status,
    };
  }

  verifyRazorpayPayment(dto: VerifyRazorpayPaymentDto) {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keySecret) {
      if (
        dto.razorpayOrderId.startsWith('order_mock_') &&
        dto.razorpayPaymentId.startsWith('pay_mock_') &&
        dto.razorpaySignature === 'mock_signature'
      ) {
        return {
          mode: 'mock' as const,
          verified: true,
          orderId: dto.razorpayOrderId,
          paymentId: dto.razorpayPaymentId,
        };
      }

      throw new BadRequestException(
        'Invalid mock payment verification payload',
      );
    }

    const expectedSignature = createHmac('sha256', keySecret)
      .update(`${dto.razorpayOrderId}|${dto.razorpayPaymentId}`)
      .digest('hex');

    const actual = Buffer.from(dto.razorpaySignature);
    const expected = Buffer.from(expectedSignature);
    const verified =
      actual.length === expected.length && timingSafeEqual(actual, expected);

    if (!verified) {
      throw new BadRequestException(
        'Razorpay payment signature verification failed',
      );
    }

    return {
      mode: 'live' as const,
      verified: true,
      orderId: dto.razorpayOrderId,
      paymentId: dto.razorpayPaymentId,
    };
  }

  async findCapturedPaymentForOrder(razorpayOrderId: string, attempts = 8) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const payment =
        await this.findCapturedPaymentForOrderOnce(razorpayOrderId);

      if (payment) {
        return payment;
      }

      if (attempt < attempts) {
        await delay(1500);
      }
    }

    throw new BadRequestException(
      'No captured Razorpay payment was visible for this order yet. Please retry recovery in a few seconds.',
    );
  }

  private async findCapturedPaymentForOrderOnce(razorpayOrderId: string) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new BadRequestException(
        'Payment recovery is only available for live Razorpay orders',
      );
    }

    const response = await fetch(
      `https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpayOrderId)}/payments`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        },
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException({
        message: 'Failed to recover Razorpay payment',
        details: errorBody,
      });
    }

    const payload = (await response.json()) as {
      items?: RazorpayPaymentResponse[];
    };
    const payment = (payload.items ?? []).find(
      (item) => item.status === 'captured' || item.captured,
    );

    if (!payment) {
      return null;
    }

    return {
      mode: 'live' as const,
      verified: true,
      orderId: razorpayOrderId,
      paymentId: payment.id,
      rawPayload: payment,
    };
  }

  verifyWebhookSignature(
    rawBody: Buffer | string | undefined,
    signature: string | undefined,
  ) {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        throw new InternalServerErrorException(
          'RAZORPAY_WEBHOOK_SECRET is not configured.',
        );
      }

      return true;
    }

    if (!rawBody || !signature) {
      throw new BadRequestException('Missing Razorpay webhook signature.');
    }

    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');
    const actual = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);

    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new BadRequestException('Invalid Razorpay webhook signature.');
    }

    return true;
  }

  parseWebhookPayload(rawBody: Buffer | string | undefined) {
    if (!rawBody) {
      throw new BadRequestException('Webhook payload is empty.');
    }

    return JSON.parse(rawBody.toString()) as Prisma.JsonObject;
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
