import {
  Body,
  Controller,
  Get,
  Headers,
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
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminRegisterDto } from './dto/admin-register.dto';
import { AuthService } from './auth.service';
import { SyncGoogleUserDto } from './dto/sync-google-user.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  @Post('google/sync')
  syncGoogleUser(
    @Body() input: SyncGoogleUserDto,
    @Headers('x-auth-sync-secret') syncSecret?: string,
  ) {
    return this.authService.syncGoogleUser(input, syncSecret);
  }

  @Post('admin/register')
  registerAdmin(@Body() input: AdminRegisterDto) {
    return this.authService.registerAdmin(input);
  }

  @Post('admin/login')
  loginAdmin(@Body() input: AdminLoginDto) {
    return this.authService.loginAdmin(input);
  }

  @Get('admin/requests')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  listPendingAdminRequests() {
    return this.authService.listPendingAdminRequests();
  }

  @Patch('admin/requests/:userId/approve')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  approveAdminRequest(
    @Param('userId') userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.authService
      .approveAdminRequest(userId, request.user!.email)
      .then(async (result) => {
        await this.auditService.record({
          actor: request.user,
          action: 'admin.approve',
          entityType: 'User',
          entityId: result.user.id,
          metadata: { email: result.user.email },
        });
        return result;
      });
  }

  @Get('session')
  findSessionUser(
    @Headers('x-customer-email') customerEmail?: string,
    @Headers('x-auth-sync-secret') syncSecret?: string,
  ) {
    return this.authService.findSessionUser(customerEmail, syncSecret);
  }
}
