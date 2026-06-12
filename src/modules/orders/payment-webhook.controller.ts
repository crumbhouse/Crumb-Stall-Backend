import { Controller, Headers, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { OrdersService } from './orders.service';

@Controller('payments')
export class PaymentWebhookController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('razorpay/webhook')
  handleRazorpayWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
  ) {
    return this.ordersService.processRazorpayWebhook(
      request.rawBody,
      signature,
      eventId,
    );
  }
}
