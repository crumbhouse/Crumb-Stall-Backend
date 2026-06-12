import {
  Body,
  Controller,
  Delete,
  Get,
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
import { CreateFoodItemDto, UpdateFoodItemDto } from './dto/food-input.dto';
import {
  ListFoodQueryDto,
  parseListFoodQuery,
} from './dto/list-food-query.dto';
import { FoodService } from './food.service';

@Controller('foods')
export class FoodController {
  constructor(
    private readonly foodService: FoodService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  findAll(@Query() query: ListFoodQueryDto) {
    return this.foodService.findAll(parseListFoodQuery(query));
  }

  @Get('featured')
  findFeatured() {
    return this.foodService.findFeatured();
  }

  @Get('popular')
  findPopular() {
    return this.foodService.findPopular();
  }

  @Get('admin')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findAllForAdmin() {
    return this.foodService.findAllForAdmin();
  }

  @Post()
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async create(@Body() body: CreateFoodItemDto, @Req() request: AuthenticatedRequest) {
    const item = await this.foodService.create(body);
    await this.auditService.record({
      actor: request.user,
      action: 'food.create',
      entityType: 'FoodItem',
      entityId: item.id,
      metadata: { slug: item.slug, name: item.name },
    });
    return item;
  }

  @Patch(':foodItemId')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async update(
    @Param('foodItemId') foodItemId: string,
    @Body() body: UpdateFoodItemDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const item = await this.foodService.update(foodItemId, body);
    await this.auditService.record({
      actor: request.user,
      action: 'food.update',
      entityType: 'FoodItem',
      entityId: item.id,
      metadata: { slug: item.slug, changedFields: Object.keys(body) },
    });
    return item;
  }

  @Delete(':foodItemId')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async deactivate(
    @Param('foodItemId') foodItemId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const item = await this.foodService.deactivate(foodItemId);
    await this.auditService.record({
      actor: request.user,
      action: 'food.deactivate',
      entityType: 'FoodItem',
      entityId: item.id,
      metadata: { slug: item.slug },
    });
    return item;
  }

  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.foodService.findBySlug(slug);
  }
}
