import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUserGuard } from '../../common/auth/authenticated-user.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';
import { AnalyticsService } from './analytics.service';
import {
  parseAnalyticsLimitQuery,
  parseAnalyticsRangeQuery,
} from './dto/analytics-query.dto';

@Controller('analytics')
@UseGuards(AuthenticatedUserGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  getSummary() {
    return this.analyticsService.getSummary();
  }

  @Get('revenue-trend')
  getRevenueTrend(@Query() query: Record<string, unknown>) {
    return this.analyticsService.getRevenueTrend(
      parseAnalyticsRangeQuery(query),
    );
  }

  @Get('top-foods')
  getTopFoods(@Query() query: Record<string, unknown>) {
    return this.analyticsService.getTopFoods(parseAnalyticsLimitQuery(query));
  }

  @Get('live-queue')
  getLiveQueue(@Query() query: Record<string, unknown>) {
    return this.analyticsService.getLiveQueue(parseAnalyticsLimitQuery(query));
  }

  @Get('customer-insights')
  getCustomerInsights(@Query() query: Record<string, unknown>) {
    return this.analyticsService.getCustomerInsights(
      parseAnalyticsLimitQuery(query),
    );
  }
}
