import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUserGuard } from '../../common/auth/authenticated-user.guard';
import type { AuthenticatedRequest } from '../../common/auth/authenticated-user.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';

@Controller('admin')
@UseGuards(AuthenticatedUserGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  @Get('me')
  findCurrentAdmin(@Req() request: AuthenticatedRequest) {
    return { user: request.user };
  }
}
