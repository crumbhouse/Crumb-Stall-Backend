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
import { ModerateReviewDto } from './dto/moderate-review.dto';
import { parseReviewInput } from './dto/review-input.dto';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('admin')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findAllForAdmin() {
    return this.reviewsService.findAllForAdmin();
  }

  @Get('foods/:slug')
  findForFood(
    @Param('slug') slug: string,
    @Headers('x-customer-email') customerEmail?: string,
    @Headers('x-auth-sync-secret') syncSecret?: string,
  ) {
    return this.reviewsService.findForFood(slug, customerEmail, syncSecret);
  }

  @Post('orders/:orderNumber')
  @UseGuards(AuthenticatedUserGuard)
  rateOrder(
    @Param('orderNumber') orderNumber: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reviewsService.rateOrder(
      orderNumber,
      parseReviewInput(body),
      request.user!.id,
    );
  }

  @Patch('admin/:reviewId')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  moderateReview(
    @Param('reviewId') reviewId: string,
    @Body() body: ModerateReviewDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reviewsService
      .moderateReview(reviewId, body.isHidden)
      .then(async (review) => {
        await this.auditService.record({
          actor: request.user,
          action: body.isHidden ? 'review.hide' : 'review.restore',
          entityType: 'Review',
          entityId: review.id,
          metadata: { foodItemId: review.foodItem.id },
        });
        return review;
      });
  }
}
