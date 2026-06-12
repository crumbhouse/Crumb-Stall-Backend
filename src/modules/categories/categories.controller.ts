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
import { CategoriesService } from './categories.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/category-input.dto';

@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  findAll() {
    return this.categoriesService.findAll();
  }

  @Get('admin')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findAllForAdmin() {
    return this.categoriesService.findAllForAdmin();
  }

  @Post()
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async create(@Body() body: CreateCategoryDto, @Req() request: AuthenticatedRequest) {
    const category = await this.categoriesService.create(body);
    await this.auditService.record({
      actor: request.user,
      action: 'category.create',
      entityType: 'Category',
      entityId: category.id,
      metadata: { slug: category.slug, name: category.name },
    });
    return category;
  }

  @Patch(':categoryId')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async update(
    @Param('categoryId') categoryId: string,
    @Body() body: UpdateCategoryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const category = await this.categoriesService.update(categoryId, body);
    await this.auditService.record({
      actor: request.user,
      action: 'category.update',
      entityType: 'Category',
      entityId: category.id,
      metadata: { slug: category.slug, changedFields: Object.keys(body) },
    });
    return category;
  }

  @Delete(':categoryId')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async deactivate(
    @Param('categoryId') categoryId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const category = await this.categoriesService.deactivate(categoryId);
    await this.auditService.record({
      actor: request.user,
      action: 'category.deactivate',
      entityType: 'Category',
      entityId: category.id,
      metadata: { slug: category.slug },
    });
    return category;
  }
}
