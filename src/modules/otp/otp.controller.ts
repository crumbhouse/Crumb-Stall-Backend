import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUserGuard } from '../../common/auth/authenticated-user.guard';
import type { AuthenticatedRequest } from '../../common/auth/authenticated-user.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { VerifyOrderOtpDto } from './dto/verify-order-otp.dto';
import { OtpService } from './otp.service';

@Controller('orders/:orderNumber/otp')
@UseGuards(AuthenticatedUserGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class OtpController {
  constructor(
    private readonly otpService: OtpService,
    private readonly auditService: AuditService,
  ) {}

  @Post('generate')
  async generate(
    @Param('orderNumber') orderNumber: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const otp = await this.otpService.generateForOrderNumber(orderNumber, {
      forceRefresh: true,
    });
    await this.auditService.record({
      actor: request.user,
      action: 'otp.generate',
      entityType: 'Order',
      entityId: orderNumber,
      metadata: { orderNumber },
    });
    return otp;
  }

  @Post('verify')
  verify(
    @Param('orderNumber') orderNumber: string,
    @Body() body: VerifyOrderOtpDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.otpService.verifyForOrderNumber(orderNumber, body.otp).then(async (result) => {
      await this.auditService.record({
        actor: request.user,
        action: 'otp.verify',
        entityType: 'Order',
        entityId: orderNumber,
        metadata: { orderNumber, verified: result.verified },
      });
      return result;
    });
  }
}
