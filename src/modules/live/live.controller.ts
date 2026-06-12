import { Controller, Req, Sse, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUserGuard } from '../../common/auth/authenticated-user.guard';
import type { AuthenticatedRequest } from '../../common/auth/authenticated-user.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';
import { LiveEventsService } from './live-events.service';

@Controller('live')
export class LiveController {
  constructor(private readonly liveEventsService: LiveEventsService) {}

  @Sse('customer')
  @UseGuards(AuthenticatedUserGuard)
  customer(@Req() request: AuthenticatedRequest) {
    return this.liveEventsService.customerEvents(request.user!.id);
  }

  @Sse('admin')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  admin() {
    return this.liveEventsService.adminEvents();
  }
}
