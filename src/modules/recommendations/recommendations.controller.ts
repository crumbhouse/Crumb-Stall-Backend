import { Controller, Get, Headers, Query } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { parseRecommendationsQuery } from './dto/recommendations-query.dto';
import { RecommendationsService } from './recommendations.service';

@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendationsService: RecommendationsService,
  ) {}

  @Get('foods')
  async findFoodRecommendations(
    @Query() query: Record<string, unknown>,
    @Headers('x-customer-email') customerEmail?: string,
  ) {
    const userId = customerEmail
      ? await this.findActiveUserId(customerEmail)
      : undefined;

    return this.recommendationsService.findForUser(
      userId,
      parseRecommendationsQuery(query),
    );
  }

  private async findActiveUserId(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        isSuspended: true,
      },
    });

    return user && !user.isSuspended ? user.id : undefined;
  }
}
