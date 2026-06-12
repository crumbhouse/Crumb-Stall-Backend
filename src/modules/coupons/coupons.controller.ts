import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUserGuard } from '../../common/auth/authenticated-user.guard';
import type { AuthenticatedRequest } from '../../common/auth/authenticated-user.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { CouponsService } from './coupons.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon-input.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';

@Controller('coupons')
export class CouponsController {
  constructor(
    private readonly couponsService: CouponsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('admin')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findAllForAdmin() {
    return this.couponsService.findAllForAdmin();
  }

  @Post('validate')
  validateCoupon(@Body() input: ValidateCouponDto) {
    return this.couponsService.validateCoupon(input);
  }

  @Post()
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async create(@Body() input: CreateCouponDto, @Req() request: AuthenticatedRequest) {
    const coupon = await this.couponsService.create(input);
    await this.auditService.record({
      actor: request.user,
      action: 'coupon.create',
      entityType: 'Coupon',
      entityId: coupon.id,
      metadata: { code: coupon.code },
    });
    return coupon;
  }

  @Patch(':couponId')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async update(
    @Param('couponId') couponId: string,
    @Body() input: UpdateCouponDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const coupon = await this.couponsService.update(couponId, input);
    await this.auditService.record({
      actor: request.user,
      action: 'coupon.update',
      entityType: 'Coupon',
      entityId: coupon.id,
      metadata: { code: coupon.code, changedFields: Object.keys(input) },
    });
    return coupon;
  }

  @Delete(':couponId')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async deactivate(
    @Param('couponId') couponId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const coupon = await this.couponsService.deactivate(couponId);
    await this.auditService.record({
      actor: request.user,
      action: 'coupon.deactivate',
      entityType: 'Coupon',
      entityId: coupon.id,
      metadata: { code: coupon.code },
    });
    return coupon;
  }
}
