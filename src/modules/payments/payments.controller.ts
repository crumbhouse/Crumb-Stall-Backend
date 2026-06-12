import { Body, Controller, Post } from '@nestjs/common';
import { VerifyRazorpayPaymentDto } from './dto/verify-razorpay-payment.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('razorpay/verify')
  verifyRazorpayPayment(@Body() body: VerifyRazorpayPaymentDto) {
    return this.paymentsService.verifyRazorpayPayment(body);
  }
}
