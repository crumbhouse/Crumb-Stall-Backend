import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUserGuard } from '../../common/auth/authenticated-user.guard';
import type { AuthenticatedRequest } from '../../common/auth/authenticated-user.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';
import { AuditService } from '../../infrastructure/audit/audit.service';
import {
  parseConfirmCheckoutPaymentDto,
  parseRecoverCheckoutOrderDto,
  parseStartCheckoutOrderDto,
} from './dto/create-checkout-order.dto';
import { parseListOrdersQuery } from './dto/list-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  findRecentOrders(
    @Query() query: Record<string, unknown>,
    @Headers('x-customer-email') customerEmail?: string,
    @Headers('x-auth-sync-secret') syncSecret?: string,
  ) {
    return this.ordersService.findRecentOrders(
      parseListOrdersQuery(query),
      customerEmail,
      syncSecret,
    );
  }

  @Post('checkout/start')
  startCheckoutOrder(
    @Body() body: Record<string, unknown>,
    @Headers('x-customer-email') customerEmail?: string,
    @Headers('x-auth-sync-secret') syncSecret?: string,
  ) {
    return this.ordersService.startCheckoutOrder(
      parseStartCheckoutOrderDto(body),
      customerEmail,
      syncSecret,
    );
  }

  @Post('checkout/confirm')
  confirmCheckoutPayment(
    @Body() body: Record<string, unknown>,
    @Headers('x-customer-email') customerEmail?: string,
    @Headers('x-auth-sync-secret') syncSecret?: string,
  ) {
    return this.ordersService.confirmCheckoutPayment(
      parseConfirmCheckoutPaymentDto(body),
      customerEmail,
      syncSecret,
    );
  }

  @Post('checkout/recover')
  recoverCheckoutOrder(
    @Body() body: Record<string, unknown>,
    @Headers('x-customer-email') customerEmail?: string,
    @Headers('x-auth-sync-secret') syncSecret?: string,
  ) {
    return this.ordersService.recoverCheckoutOrder(
      parseRecoverCheckoutOrderDto(body),
      customerEmail,
      syncSecret,
    );
  }

  @Get('admin')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findAdminOrders(@Query() query: Record<string, unknown>) {
    return this.ordersService.findAdminOrders(parseListOrdersQuery(query));
  }

  @Get('admin/:orderNumber')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findAdminOrderByNumber(@Param('orderNumber') orderNumber: string) {
    return this.ordersService.findAdminOrderByNumber(orderNumber);
  }

  @Patch(':orderNumber/status')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  updateStatus(
    @Param('orderNumber') orderNumber: string,
    @Body() body: UpdateOrderStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.ordersService.updateStatus(orderNumber, body).then(async (order) => {
      await this.auditService.record({
        actor: request.user,
        action: 'order.status.update',
        entityType: 'Order',
        entityId: order.id,
        metadata: { orderNumber, status: body.status },
      });
      return order;
    });
  }

  @Get(':orderNumber')
  findByOrderNumber(
    @Param('orderNumber') orderNumber: string,
    @Headers('x-customer-email') customerEmail?: string,
    @Headers('x-auth-sync-secret') syncSecret?: string,
  ) {
    return this.ordersService.findByOrderNumber(
      orderNumber,
      customerEmail,
      syncSecret,
    );
  }
}
