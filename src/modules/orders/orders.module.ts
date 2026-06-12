import { Module } from '@nestjs/common';
import { CouponsModule } from '../coupons/coupons.module';
import { LiveModule } from '../live/live.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OtpModule } from '../otp/otp.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentWebhookController } from './payment-webhook.controller';

@Module({
  imports: [
    CouponsModule,
    LiveModule,
    NotificationsModule,
    PaymentsModule,
    OtpModule,
  ],
  controllers: [OrdersController, PaymentWebhookController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
