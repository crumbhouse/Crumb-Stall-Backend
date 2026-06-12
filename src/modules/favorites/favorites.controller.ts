import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUserGuard } from '../../common/auth/authenticated-user.guard';
import type { AuthenticatedRequest } from '../../common/auth/authenticated-user.guard';
import { FavoritesService } from './favorites.service';

@Controller('favorites')
@UseGuards(AuthenticatedUserGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  findAll(@Req() request: AuthenticatedRequest) {
    return this.favoritesService.findAllForUser(request.user!.id);
  }

  @Get('ids')
  findIds(@Req() request: AuthenticatedRequest) {
    return this.favoritesService.findIdsForUser(request.user!.id);
  }

  @Post(':slug')
  add(@Param('slug') slug: string, @Req() request: AuthenticatedRequest) {
    return this.favoritesService.addForUser(slug, request.user!.id);
  }

  @Delete(':slug')
  remove(@Param('slug') slug: string, @Req() request: AuthenticatedRequest) {
    return this.favoritesService.removeForUser(slug, request.user!.id);
  }
}
